// The contextual engine (spec §5). All resolution is server-side — the client
// never holds mapping tables.
//
// Level A: placement rules pick WHICH widget instance to serve.
// Level B: the instance's SOURCES contribute candidate products (one source per
//          advertiser feed, each with its own conditions and cap), and the
//          instance's kv_mappings then narrow that pool by the page's
//          key-values — including dictionary matching on multi-value keys
//          (mv_ingredients → "skinkeschnitzler" ⇒ svinekød).
// Fallback chain: mapped match → explicit default set → render nothing.

import { query, sql } from './db';
import { compileRule, type RuleConditions } from './rules';
import { matchSegments, segmentTerms, type DictEntries } from './dict';
import type { DesignTokens, ServeProduct, ServeResponse, TemplateId, TemplateMeta } from './serve-types';

type Kv = Record<string, string>;

interface PlacementRule {
  match: { key: string; operator: 'eq' | 'contains' | 'dict'; value?: string; dict_id?: string; segment?: string };
  instance_id: string;
}

interface ProductRow {
  id: string;
  title: string;
  link: string;
  affiliate_url: string | null;
  image_link: string | null;
  price_amount: string | null;
  price_currency: string | null;
  sale_price_amount: string | null;
  sale_price_currency: string | null;
  brand: string | null;
  product_type: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  /** Provenance, so shared-widget events attribute to the right advertiser. */
  advertiser_id: string;
  source_id: string;
}

export interface ResolveInput {
  placementCode: string;
  kv: Kv;
  origin: string; // public base URL for click redirects + event beacons
  /** Reported by the client; baked into click URLs so clicks and impressions
   *  aggregate into the same stats_hourly row. */
  deviceClass?: string;
  preview?: boolean; // admin preview: allow draft instances
}

function kvValue(kv: Kv, key: string): string | undefined {
  if (key in kv) return kv[key];
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(kv)) if (k.toLowerCase() === lower) return v;
  return undefined;
}

// Dictionaries change rarely and are read once per mapping evaluated, so a
// short-lived cache removes several DB round-trips from every serve.
const dictCache = new Map<string, { at: number; entries: DictEntries }>();
const DICT_TTL_MS = 60_000;

async function loadDictionary(dictId: string): Promise<DictEntries> {
  const cached = dictCache.get(dictId);
  if (cached && Date.now() - cached.at < DICT_TTL_MS) return cached.entries;
  const rows = await query<{ entries: DictEntries }>(
    'select entries from kv_dictionary where id = $1',
    [dictId],
  );
  const entries = rows[0]?.entries ?? {};
  dictCache.set(dictId, { at: Date.now(), entries });
  return entries;
}

async function matchCondition(
  match: PlacementRule['match'],
  kv: Kv,
): Promise<{ hit: boolean; matchedTerms?: string[] }> {
  const pageValue = kvValue(kv, match.key);
  if (pageValue === undefined) return { hit: false };
  switch (match.operator) {
    case 'eq':
      return { hit: pageValue.toLowerCase() === String(match.value ?? '').toLowerCase() };
    case 'contains':
      return { hit: pageValue.toLowerCase().includes(String(match.value ?? '').toLowerCase()) };
    case 'dict': {
      if (!match.dict_id || !match.segment) return { hit: false };
      const bySegment = matchSegments(await loadDictionary(match.dict_id), pageValue);
      const terms = segmentTerms(bySegment, match.segment);
      return terms ? { hit: true, matchedTerms: terms } : { hit: false };
    }
    default:
      return { hit: false };
  }
}

/**
 * What a matched targeting rule does to the candidate pool:
 *  - `filter`  narrow the pool with these conditions (works across all sources)
 *  - `rule`    narrow using a saved product_rule's conditions
 *  - `explicit` show exactly these products
 *  - `all`     show the pool unchanged (a pure show/hide rule)
 *  - `hide`    do not render at all
 */
type Target =
  | { kind: 'filter'; conditions: RuleConditions }
  | { kind: 'rule'; rule_id: string }
  | { kind: 'explicit'; product_ids: string[] }
  | { kind: 'all' }
  | { kind: 'hide' }
  // Legacy shorthand from before shared widgets.
  | { kind: 'full_feed'; feed_id?: string };

/**
 * A product contribution: one advertiser's feed plus the conditions that select
 * from it, and an optional cap. Several of these pool into one widget — which is
 * what lets a single wine widget carry 10 products from one chain's feed, 100
 * from another and 2 from a third.
 */
interface SourceRow {
  id: string;
  advertiser_id: string;
  feed_id: string;
  conditions: RuleConditions | null;
  max_products: number | null;
  /** Slots this source takes per interleave round (advertiser weight). */
  weight: number | null;
}

const PRODUCT_COLS = `p.id, p.title, p.link, p.affiliate_url, p.image_link,
  p.price_amount::text, p.price_currency, p.sale_price_amount::text, p.sale_price_currency,
  p.brand, p.product_type, p.custom_label_1, p.custom_label_2`;

/**
 * Renderable = the feed is fresh AND the product is in stock.
 *
 * `available` is the soft-delete flag (present in the latest fetch);
 * `availability` is the feed's own stock field — advertising a sold-out product
 * at a price is the same class of problem as advertising a stale one. Manual
 * feeds are exempt from fetch freshness: nothing fetches them, the admin
 * maintains them by hand.
 */
const RENDERABLE = `
  p.available
  and exists (select 1 from feed f where f.id = p.feed_id
              and (f.type = 'manual'
                   or (f.status = 'healthy'
                       and f.last_fetch_at > now() - (f.max_age_hours || ' hours')::interval)))
  and (p.availability is null
       or lower(replace(p.availability, '_', ' '))
          in ('in stock', 'instock', 'preorder', 'backorder', 'available for order'))`;

/**
 * Relevance, not price: custom_label_2 carries the advertiser's 0–100 match
 * score, so the highest-scoring product leads (and matches the "Bedste match"
 * badge the template puts on it). The regex guard keeps a non-numeric label
 * from breaking the cast; price is the tie-breaker for feeds with no score.
 */
const RELEVANCE_ORDER = `
  (case when p.custom_label_2 ~ '^[0-9]+(\\.[0-9]+)?$' then p.custom_label_2::numeric end) desc nulls last,
  coalesce(p.sale_price_amount, p.price_amount) nulls last`;

function relevance(p: ProductRow): number {
  const n = Number(p.custom_label_2);
  return Number.isFinite(n) ? n : -1;
}

/**
 * Resolves one source's candidates. The feed is pinned to that source's own
 * advertiser, so a mis-configured condition can never pull a competitor's
 * catalogue into an advertiser's widget — and clicks stay attributable.
 */
async function resolveSource(source: SourceRow, limit: number): Promise<ProductRow[]> {
  const params: unknown[] = [source.feed_id, source.advertiser_id, source.id];
  let where = `p.feed_id = $1
    and exists (select 1 from feed own where own.id = p.feed_id and own.advertiser_id = $2)
    and ${RENDERABLE}`;

  if (source.conditions) {
    const compiled = compileRule(source.conditions, params.length, 'p.');
    where += ` and (${compiled.where})`;
    params.push(...compiled.params);
  }
  const cap = Math.max(1, Math.min(limit, source.max_products ?? limit));
  params.push(cap);
  return query<ProductRow>(
    `select ${PRODUCT_COLS}, $2::uuid as advertiser_id, $3::uuid as source_id
     from product p
     where ${where}
     order by ${RELEVANCE_ORDER}
     limit $${params.length}`,
    params,
  );
}

/** Explicit product list: exact products, in the order the admin chose them. */
async function resolveExplicit(productIds: string[], sources: SourceRow[], limit: number): Promise<ProductRow[]> {
  if (!productIds.length || !sources.length) return [];
  const feedIds = sources.map((s) => s.feed_id);
  return query<ProductRow>(
    `select ${PRODUCT_COLS},
            (select own.advertiser_id from feed own where own.id = p.feed_id) as advertiser_id,
            (select s.id from instance_source s where s.feed_id = p.feed_id limit 1) as source_id
     from product p
     where p.id = any($1) and p.feed_id = any($2) and ${RENDERABLE}
     order by array_position($1::uuid[], p.id)
     limit $3`,
    [productIds, feedIds, limit],
  );
}

/**
 * Pools candidates from every source, narrowed by the matched targeting rule,
 * then fills the widget's slots.
 *
 * Allocation matters commercially. Ranking the pooled set purely by relevance
 * lets the advertiser with the biggest catalogue take every slot — a
 * 200-product feed simply outnumbers a 10-product one, so the smaller
 * advertiser pays for a widget they never appear in. So slots are interleaved
 * round-robin across sources (priority order, `weight` slots per round), with
 * each source's own candidates relevance-ordered within its turn.
 *
 * An exclusive widget has one source, where interleaving and pure relevance are
 * the same thing.
 */
async function poolProducts(
  sources: SourceRow[],
  slots: number,
  narrow: RuleConditions | null,
): Promise<ProductRow[]> {
  if (!sources.length) return [];
  const pools = await Promise.all(
    sources.map((source) => {
      const conditions: RuleConditions | null =
        narrow && source.conditions
          ? ({ all: [source.conditions, narrow] } as unknown as RuleConditions)
          : (narrow ?? source.conditions);
      // Over-fetch per source so interleaving has something to choose from,
      // but never beyond the source's own cap.
      return resolveSource({ ...source, conditions }, slots * 4);
    }),
  );

  const queues = pools.map((rows) => rows.slice().sort((a, b) => relevance(b) - relevance(a)));
  const picked: ProductRow[] = [];
  let progress = true;
  while (picked.length < slots && progress) {
    progress = false;
    for (let i = 0; i < queues.length && picked.length < slots; i++) {
      const take = Math.max(1, sources[i].weight ?? 1);
      for (let n = 0; n < take && picked.length < slots; n++) {
        const next = queues[i].shift();
        if (!next) break;
        picked.push(next);
        progress = true;
      }
    }
  }
  return picked;
}

/** Resolves a matched target into products drawn from the instance's sources. */
async function resolveTarget(
  target: Target | null,
  sources: SourceRow[],
  slots: number,
): Promise<ProductRow[]> {
  if (!target || target.kind === 'hide') return [];
  if (target.kind === 'all' || target.kind === 'full_feed') return poolProducts(sources, slots, null);
  if (target.kind === 'filter') return poolProducts(sources, slots, target.conditions);
  if (target.kind === 'explicit') return resolveExplicit(target.product_ids ?? [], sources, slots);
  if (target.kind === 'rule') {
    const rules = await query<{ conditions: RuleConditions; feed_id: string }>(
      'select conditions, feed_id from product_rule where id = $1',
      [target.rule_id],
    );
    if (!rules[0]) return [];
    // A saved rule belongs to one feed, so apply it only to the sources drawing
    // on that feed; the rest of the pool is unaffected.
    const scoped = sources.filter((s) => s.feed_id === rules[0].feed_id);
    return poolProducts(scoped.length ? scoped : sources, slots, rules[0].conditions);
  }
  return [];
}

function formatPrice(amount: string | null, currency: string | null): string | undefined {
  if (!amount) return undefined;
  const n = Number(amount);
  if (!Number.isFinite(n)) return undefined;
  const whole = Number.isInteger(n);
  const formatted = n.toLocaleString('da-DK', {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const suffix = !currency || currency === 'DKK' ? ',-' : ` ${currency}`;
  return whole ? `${formatted}${suffix}` : `${formatted}${currency && currency !== 'DKK' ? ` ${currency}` : ' kr.'}`;
}

function toServeProduct(
  row: ProductRow,
  instanceId: string,
  placementId: string,
  origin: string,
  deviceClass: string,
): ServeProduct {
  const sale = formatPrice(row.sale_price_amount, row.sale_price_currency);
  const price = formatPrice(row.price_amount, row.price_currency);
  let badge: string | undefined;
  if (row.sale_price_amount && row.price_amount) {
    const pct = Math.round((1 - Number(row.sale_price_amount) / Number(row.price_amount)) * 100);
    if (pct >= 5) badge = `-${pct}%`;
  }
  // Feed conventions for the native templates: custom_label_1 carries the
  // one-line "derfor" pairing explanation, custom_label_2 a 0–100 match score.
  // Both are advertiser-controlled feed fields; templates render them only
  // when present.
  const score = row.custom_label_2 ? Number(row.custom_label_2) : NaN;
  // The source id travels on the click so shared-widget clicks attribute to the
  // advertiser that actually supplied the product.
  const click = `${origin}/c/${row.id}?i=${instanceId}&pl=${placementId}`
    + `&d=${encodeURIComponent(deviceClass)}&s=${row.source_id}`;
  return {
    id: row.id,
    title: row.title,
    clickUrl: click,
    imageUrl: row.image_link ?? undefined,
    price,
    salePrice: sale,
    brand: row.brand ?? undefined,
    subtitle: row.product_type?.split('>').map((s) => s.trim()).join(' · ') ?? row.brand ?? undefined,
    reason: row.custom_label_1 ?? undefined,
    matchScore: Number.isFinite(score) && score >= 0 && score <= 100 ? score : undefined,
    badge,
  };
}

export async function resolveServe(input: ResolveInput): Promise<ServeResponse> {
  const { kv, origin } = input;

  // Contextual-only stance: limited_ads is respected as a serve-time signal.
  const limited = kvValue(kv, 'limited_ads');
  if (limited && ['true', '1', 'yes'].includes(limited.toLowerCase())) {
    return { render: false, reason: 'limited_ads' };
  }

  const placements = await query<{
    id: string; site_id: string; rules: PlacementRule[]; default_instance_id: string | null; status: string;
  }>('select id, site_id, rules, default_instance_id, status from placement where code = $1', [input.placementCode]);
  const placement = placements[0];
  if (!placement || placement.status !== 'live') return { render: false, reason: 'unknown_placement' };

  // Level A: ordered placement rules pick the instance.
  let instanceId: string | null = null;
  for (const rule of placement.rules ?? []) {
    const { hit } = await matchCondition(rule.match, kv);
    if (hit) {
      instanceId = rule.instance_id;
      break;
    }
  }
  instanceId ??= placement.default_instance_id;
  if (!instanceId) return { render: false, reason: 'no_rule_match' };

  const instances = await query<{
    id: string; name: string; status: string; site_id: string; widget_type: string; mode: string;
    layout_type: TemplateId; design_tokens: DesignTokens; slot_count: { default?: number };
    behaviours: Record<string, unknown>; token_overrides: DesignTokens;
    fallback_config: { strategy: 'default_products' | 'hide'; target?: Target; unmapped?: boolean };
    meta_config: TemplateMeta | null;
  }>(
    `select wi.id, wi.name, wi.status, wi.site_id, wi.widget_type, wi.mode,
            wt.layout_type, wt.design_tokens, wt.slot_count, wt.behaviours,
            wi.token_overrides, wi.fallback_config,
            (wi.token_overrides -> '__meta') as meta_config
     from widget_instance wi
     join widget_template wt on wt.id = wi.template_id
     where wi.id = $1`,
    [instanceId],
  );
  const inst = instances[0];
  if (!inst) return { render: false, reason: 'no_instance' };
  if (inst.status !== 'live' && !input.preview) return { render: false, reason: 'instance_not_live' };

  const slots = inst.slot_count?.default ?? 3;

  // The advertisers in this widget, for branding and attribution. In a shared
  // widget several participate; the meta shows the one whose product leads.
  const advertisers = await query<{ id: string; name: string; logo_asset_id: string | null }>(
    `select a.id, a.name, a.logo_asset_id
     from instance_advertiser ia join advertiser a on a.id = ia.advertiser_id
     where ia.instance_id = $1 order by ia.priority, a.name`,
    [instanceId],
  );
  if (!advertisers.length) return { render: false, reason: 'no_advertiser' };

  const sources = await query<SourceRow>(
    `select s.id, s.advertiser_id, s.feed_id, s.conditions, s.max_products, ia.weight
     from instance_source s
     left join instance_advertiser ia
       on ia.instance_id = s.instance_id and ia.advertiser_id = s.advertiser_id
     where s.instance_id = $1
     order by s.priority`,
    [instanceId],
  );

  // A takeover widget can legitimately carry no products at all — it is a
  // branding unit. Everything else needs a product pool.
  const isTakeover = inst.widget_type === 'takeover';
  if (!isTakeover && !sources.length) return { render: false, reason: 'no_sources' };

  // Level B: targeting rules in priority order, strict first-match-wins.
  const mappings = await query<{
    id: string; page_key: string; operator: 'eq' | 'contains' | 'dict';
    page_value: string | null; dict_id: string | null; segment: string | null; target: Target;
  }>(
    `select id, page_key, operator, page_value, dict_id, segment, target
     from kv_mapping where instance_id = $1 order by priority`,
    [instanceId],
  );

  let rows: ProductRow[] = [];
  let matchedTerms: string[] = [];
  let matchedMapping = false;
  for (const m of mappings) {
    const { hit, matchedTerms: terms } = await matchCondition(
      {
        key: m.page_key, operator: m.operator, value: m.page_value ?? undefined,
        dict_id: m.dict_id ?? undefined, segment: m.segment ?? undefined,
      },
      kv,
    );
    if (!hit) continue;
    // Strict priority: the FIRST matching rule decides, exactly as the admin
    // promises ("evalueres i prioritetsrækkefølge"). Falling through to a later
    // rule would silently serve a different context than was configured.
    matchedMapping = true;
    matchedTerms = terms ?? [];
    if (m.target?.kind === 'hide') return { render: false, reason: 'targeting_hide' };
    rows = await resolveTarget(m.target, sources, slots);
    break;
  }

  // Fallback chain: matched rule → explicit default set → nothing. An instance
  // with NO targeting rules only serves its whole pool when that is a
  // deliberate choice, never implicitly — otherwise a half-configured widget
  // quietly serves the entire catalogue on every matching page.
  if (!rows.length && !isTakeover) {
    if (inst.fallback_config?.strategy === 'default_products' && inst.fallback_config.target) {
      rows = await resolveTarget(inst.fallback_config.target, sources, slots);
    } else if (!mappings.length && inst.fallback_config?.unmapped === true) {
      rows = await poolProducts(sources, slots, null);
    }
  }
  if (!rows.length && !isTakeover) {
    return { render: false, reason: mappings.length ? 'no_products' : 'no_targeting' };
  }

  const device = ['desktop', 'tablet', 'mobile'].includes(input.deviceClass ?? '')
    ? (input.deviceClass as string)
    : 'unknown';
  const products = rows.map((r) => toServeProduct(r, inst.id, placement.id, origin, device));

  // Attribution: the advertiser whose product leads the widget. In an exclusive
  // widget that is the only participant.
  const leadAdvertiserId = rows[0]?.advertiser_id ?? advertisers[0].id;
  const lead = advertisers.find((a) => a.id === leadAdvertiserId) ?? advertisers[0];

  const metaConfig = (inst.meta_config ?? (inst.behaviours as { meta?: TemplateMeta })?.meta ?? {}) as Partial<TemplateMeta>;
  const meta: TemplateMeta = {
    advertiserName: lead.name,
    advertiserLogoUrl: lead.logo_asset_id ? `${origin}/api/asset/${lead.logo_asset_id}` : undefined,
    ...metaConfig,
    chips: matchedTerms.length ? matchedTerms.slice(0, 4) : undefined,
  };
  // Never assert a contextual match we did not make: the match line and chips
  // are only shown when a targeting rule actually matched this page.
  if (!matchedMapping) {
    meta.matchLine = undefined;
    meta.chips = undefined;
  }

  const { customCss: _drop, ...overrides } = inst.token_overrides ?? {};
  delete (overrides as Record<string, unknown>)['__meta'];
  const tokens: DesignTokens = { ...inst.design_tokens, ...overrides };
  if (inst.design_tokens?.customCss) tokens.customCss = inst.design_tokens.customCss;

  return {
    render: true,
    template: inst.layout_type,
    tokens,
    products,
    meta,
    tracking: {
      endpoint: origin,
      placementId: placement.id,
      instanceId: inst.id,
      advertiserId: lead.id,
      siteId: inst.site_id,
    },
  };
}

/**
 * Records the outcome of a serve so no-render decisions are visible. The widget
 * fails silent by design, so without this a misspelled key-value looks exactly
 * like "no traffic yet". Never throws: telemetry must not break a serve.
 */
export async function recordServeDecision(placementCode: string, reason: string): Promise<void> {
  try {
    await query(
      `insert into serve_decision (hour, placement_id, reason, count)
       select date_trunc('hour', now()), p.id, $2, 1 from placement p where p.code = $1
       on conflict (hour, placement_id, reason) do update set count = serve_decision.count + 1`,
      [placementCode, reason.slice(0, 40)],
    );
  } catch {
    /* telemetry is best-effort */
  }
}

export { sql };
