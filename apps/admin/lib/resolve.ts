// The contextual engine (spec §5). All resolution is server-side — the client
// never holds mapping tables.
//
// Level A: placement rules pick WHICH widget instance to serve.
// Level B: instance kv_mappings pick WHICH products, incl. dictionary matching
//          on multi-value keys (mv_ingredients → "skinkeschnitzler" ⇒ svinekød).
// Fallback chain: mapped match → instance default set → render nothing.

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
  image_link: string | null;
  price_amount: string | null;
  price_currency: string | null;
  sale_price_amount: string | null;
  sale_price_currency: string | null;
  brand: string | null;
  product_type: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
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

interface ProductSource {
  kind: 'rule' | 'explicit' | 'full_feed';
  rule_id?: string;
  product_ids?: string[];
  feed_id?: string;
}

// A recommendation widget ranks by relevance, not by price: custom_label_2
// carries the advertiser's 0-100 match score, so the highest-scoring product
// leads (and matches the "Bedste match" badge the template puts on it). The
// regex guard keeps a non-numeric label from breaking the cast. Price is the
// tie-breaker for feeds that carry no score.
const RELEVANCE_ORDER = `
  (case when custom_label_2 ~ '^[0-9]+(\\.[0-9]+)?$' then custom_label_2::numeric end) desc nulls last,
  coalesce(sale_price_amount, price_amount) nulls last`;

/**
 * Resolves a product source to renderable rows; stale-feed products never
 * render (spec §4.5). `advertiserId` is the exclusivity boundary: every product
 * served must belong to the instance's own advertiser, so a rule or explicit
 * list that points at another advertiser's feed returns nothing rather than
 * rendering a competitor's products under this advertiser's branding (and
 * billing the clicks to the wrong party).
 */
async function resolveProducts(
  source: ProductSource,
  feedId: string,
  limit: number,
  advertiserId: string,
): Promise<ProductRow[]> {
  const ownedFeed = `
    exists (select 1 from feed ownf where ownf.id = product.feed_id and ownf.advertiser_id = $3)`;
  // Renderable = fresh AND in stock. The `available` column is the soft-delete
  // flag (present in the latest fetch); `availability` is the feed's own stock
  // field, and advertising a sold-out product at a price is the same class of
  // problem as advertising a stale one. Enforced here so no product_source
  // branch can forget it.
  const renderable = `
    exists (select 1 from feed f where f.id = product.feed_id
            and f.status = 'healthy'
            and f.last_fetch_at > now() - (f.max_age_hours || ' hours')::interval)
    and (product.availability is null
         or lower(replace(product.availability, '_', ' '))
            in ('in stock', 'instock', 'preorder', 'backorder', 'available for order'))`;
  const cols = `id, title, link, image_link, price_amount::text, price_currency,
                sale_price_amount::text, sale_price_currency, brand, product_type,
                custom_label_1, custom_label_2`;

  if (source.kind === 'explicit' && source.product_ids?.length) {
    return query<ProductRow>(
      // Preserve the order the admin picked the products in.
      `select ${cols} from product
       where id = any($1) and available and ${ownedFeed} and ${renderable}
       order by array_position($1::uuid[], id)
       limit $2`,
      [source.product_ids, limit, advertiserId],
    );
  }
  if (source.kind === 'rule' && source.rule_id) {
    const rules = await query<{ feed_id: string; conditions: RuleConditions; advertiser_id: string }>(
      `select pr.feed_id, pr.conditions, f.advertiser_id
       from product_rule pr join feed f on f.id = pr.feed_id
       where pr.id = $1`,
      [source.rule_id],
    );
    if (!rules[0] || rules[0].advertiser_id !== advertiserId) return [];
    const compiled = compileRule(rules[0].conditions, 3);
    return query<ProductRow>(
      `select ${cols} from product
       where feed_id = $1 and available and ${ownedFeed} and ${renderable} and (${compiled.where})
       order by ${RELEVANCE_ORDER}
       limit $2`,
      [rules[0].feed_id, limit, advertiserId, ...compiled.params],
    );
  }
  if (source.kind === 'full_feed') {
    const target = source.feed_id ?? feedId;
    if (!target) return [];
    return query<ProductRow>(
      `select ${cols} from product
       where feed_id = $1 and available and ${ownedFeed} and ${renderable}
       order by ${RELEVANCE_ORDER}, updated_at desc
       limit $2`,
      [target, limit, advertiserId],
    );
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
  return {
    id: row.id,
    title: row.title,
    clickUrl: `${origin}/c/${row.id}?i=${instanceId}&pl=${placementId}&d=${encodeURIComponent(deviceClass)}`,
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
    id: string; name: string; status: string; site_id: string;
    layout_type: TemplateId; design_tokens: DesignTokens; slot_count: { default?: number };
    behaviours: Record<string, unknown>; token_overrides: DesignTokens;
    fallback_config: { strategy: 'default_products' | 'hide'; product_source?: ProductSource; unmapped?: boolean };
    advertiser_id: string; advertiser_name: string; product_source: ProductSource; feed_id: string | null;
    meta_config: TemplateMeta | null;
  }>(
    `select wi.id, wi.name, wi.status, wi.site_id,
            wt.layout_type, wt.design_tokens, wt.slot_count, wt.behaviours,
            wi.token_overrides, wi.fallback_config,
            ia.advertiser_id, a.name as advertiser_name, ia.product_source,
            (select f.id from feed f where f.advertiser_id = ia.advertiser_id order by f.created_at limit 1) as feed_id,
            (wi.token_overrides -> '__meta') as meta_config
     from widget_instance wi
     join widget_template wt on wt.id = wi.template_id
     join instance_advertiser ia on ia.instance_id = wi.id
     join advertiser a on a.id = ia.advertiser_id
     where wi.id = $1`,
    [instanceId],
  );
  const inst = instances[0];
  if (!inst) return { render: false, reason: 'no_instance' };
  if (inst.status !== 'live' && !input.preview) return { render: false, reason: 'instance_not_live' };

  const slots = inst.slot_count?.default ?? 3;

  // Level B: kv_mappings in priority order; fallback chain after.
  const mappings = await query<{
    id: string; page_key: string; operator: 'eq' | 'contains' | 'dict';
    page_value: string | null; dict_id: string | null; segment: string | null; target: ProductSource;
  }>(
    'select id, page_key, operator, page_value, dict_id, segment, target from kv_mapping where instance_id = $1 order by priority',
    [instanceId],
  );

  let rows: ProductRow[] = [];
  let matchedTerms: string[] = [];
  let matchedMapping = false;
  for (const m of mappings) {
    const { hit, matchedTerms: terms } = await matchCondition(
      { key: m.page_key, operator: m.operator, value: m.page_value ?? undefined, dict_id: m.dict_id ?? undefined, segment: m.segment ?? undefined },
      kv,
    );
    if (!hit) continue;
    // Strict priority: the FIRST matching mapping decides, exactly as the admin
    // UI promises ("evalueres i prioritetsrækkefølge"). Falling through to a
    // later segment when this one is out of stock would silently serve a
    // different context than the operator configured.
    matchedTerms = terms ?? [];
    matchedMapping = true;
    rows = await resolveProducts(m.target, inst.feed_id ?? '', slots, inst.advertiser_id);
    break;
  }
  // Fallback chain (spec §5B): mapped match → explicit default set → nothing.
  // An instance with NO mappings is only allowed to serve its own product
  // source when that is a deliberate choice (fallback strategy
  // 'default_products', or an explicit "unmapped": true), never implicitly —
  // otherwise deleting the mappings, or flipping a half-configured instance
  // live, quietly serves the whole catalogue on every matching page. That is
  // the inversion of the locked decision "better nothing than a clashing wine".
  if (!rows.length) {
    if (inst.fallback_config?.strategy === 'default_products' && inst.fallback_config.product_source) {
      rows = await resolveProducts(inst.fallback_config.product_source, inst.feed_id ?? '', slots, inst.advertiser_id);
    } else if (!mappings.length && inst.fallback_config?.unmapped === true) {
      rows = await resolveProducts(inst.product_source, inst.feed_id ?? '', slots, inst.advertiser_id);
    }
  }
  if (!rows.length) {
    return { render: false, reason: mappings.length ? 'no_products' : 'no_mappings' };
  }

  const device = ['desktop', 'tablet', 'mobile'].includes(input.deviceClass ?? '')
    ? (input.deviceClass as string)
    : 'unknown';
  const products = rows.map((r) => toServeProduct(r, inst.id, placement.id, origin, device));
  const metaConfig = (inst.meta_config ?? (inst.behaviours as { meta?: TemplateMeta })?.meta ?? {}) as Partial<TemplateMeta>;
  const meta: TemplateMeta = {
    advertiserName: inst.advertiser_name,
    ...metaConfig,
    chips: matchedTerms.length ? matchedTerms.slice(0, 4) : undefined,
  };
  // Never assert a contextual match we did not make: the match line and chips
  // are only shown when a mapping actually matched this page.
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
      advertiserId: inst.advertiser_id,
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
