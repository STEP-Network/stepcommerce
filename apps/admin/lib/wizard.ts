// The widget-creation wizard: one path from "I want a widget" to a finished
// embed code. Everything the old separate Template/Site/Instance/Placement/
// Preview tabs did is a step here, and the wizard owns the objects it creates
// (a private design template and one placement per widget) so nobody has to
// copy a UUID between screens.
import { query } from './db';
import type { DesignTokens, TemplateMeta } from './serve-types';
import { placementCode } from './snippet';

export const STEPS = [
  { n: 1, slug: 'type', title: 'Type & site' },
  { n: 2, slug: 'advertisers', title: 'Annoncører' },
  { n: 3, slug: 'sources', title: 'Produkter' },
  { n: 4, slug: 'pricing', title: 'Monetisering' },
  { n: 5, slug: 'design', title: 'Design' },
  { n: 6, slug: 'targeting', title: 'Targeting' },
  { n: 7, slug: 'launch', title: 'Embed & live' },
] as const;

export type StepSlug = (typeof STEPS)[number]['slug'];

export function stepBySlug(slug: string | undefined): (typeof STEPS)[number] {
  return STEPS.find((s) => s.slug === slug) ?? STEPS[0];
}

/** Layouts, with the widget types each one is meant for. */
export const LAYOUTS = [
  { id: 'recipe_section', label: 'Redaktionel sektion', hint: 'Produktrække der ligner sidens eget indhold', types: ['product_match'] },
  { id: 'carousel', label: 'Karrusel', hint: 'Vandret scroll, mange produkter', types: ['product_match'] },
  { id: 'grid', label: 'Gitter', hint: 'Klassisk produktgitter', types: ['product_match'] },
  { id: 'stacked', label: 'Liste', hint: 'Lodret liste, smalle placeringer', types: ['product_match'] },
  { id: 'single_card', label: 'Enkelt kort', hint: 'Ét produkt eller ét budskab', types: ['product_match', 'takeover'] },
  { id: 'forum_post', label: 'Takeover / brandflade', hint: 'Stor brandingflade, feed er valgfrit', types: ['takeover', 'product_match'] },
] as const;

export const PRICING_MODELS = [
  { id: 'cpc', label: 'CPC', unit: 'kr. pr. klik', hint: 'Tælles og rapporteres i V1 — faktureres ikke endnu.' },
  { id: 'cpm', label: 'CPM', unit: 'kr. pr. 1.000 visninger', hint: 'Beregnes på viewable visninger.' },
  { id: 'affiliate', label: 'Affiliate', unit: '% eller aftaletekst', hint: 'Klik sendes gennem annoncørens deeplink.' },
  { id: 'fixed', label: 'Fast pris', unit: 'kr. for perioden', hint: 'Fast beløb uafhængigt af trafik.' },
] as const;

export interface SourceSummary {
  id: string;
  advertiser_id: string;
  advertiser: string;
  feed_id: string;
  feed: string;
  feed_type: string;
  feed_status: string;
  name: string | null;
  conditions: unknown;
  max_products: number | null;
  priority: number;
  /** How many products this source contributes right now. */
  matches: number;
}

export interface AdvertiserSummary {
  advertiser_id: string;
  name: string;
  logo_asset_id: string | null;
  pricing: Record<string, unknown>;
  pricing_model: string;
  rate: string | null;
  weight: number | null;
  priority: number;
}

export interface TargetingRule {
  id: string;
  page_key: string;
  operator: 'eq' | 'contains' | 'dict';
  page_value: string | null;
  dict_id: string | null;
  dict_name: string | null;
  segment: string | null;
  target: { kind: string; conditions?: unknown; rule_id?: string; product_ids?: string[] };
  priority: number;
}

export interface KvKey { key: string; label?: string; values?: string[]; multi?: boolean }

export interface Widget {
  id: string;
  name: string;
  status: string;
  widget_type: 'product_match' | 'takeover';
  mode: 'exclusive' | 'shared';
  wizard_step: number;
  token_overrides: DesignTokens & { __meta?: TemplateMeta };
  fallback_config: { strategy?: string; target?: unknown; unmapped?: boolean };
  slot_count: { default?: number };
  template_id: string;
  template_name: string;
  layout_type: string;
  design_tokens: DesignTokens;
  behaviours: Record<string, unknown>;
  site_id: string;
  domain: string;
  publisher: string;
  kv_taxonomy: { keys?: KvKey[] } | null;
  placement_id: string | null;
  placement_code: string | null;
  placement_status: string | null;
}

export async function loadWidget(id: string): Promise<Widget | null> {
  const rows = await query<Widget>(
    `select wi.id, wi.name, wi.status, wi.widget_type, wi.mode, wi.wizard_step,
            wi.token_overrides, wi.fallback_config,
            wt.id as template_id, wt.name as template_name, wt.layout_type, wt.design_tokens,
            wt.slot_count, wt.behaviours,
            s.id as site_id, s.domain, s.publisher, s.kv_taxonomy,
            p.id as placement_id, p.code as placement_code, p.status as placement_status
     from widget_instance wi
     join widget_template wt on wt.id = wi.template_id
     join site s on s.id = wi.site_id
     left join placement p on p.default_instance_id = wi.id
     where wi.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function loadAdvertisers(instanceId: string): Promise<AdvertiserSummary[]> {
  return query<AdvertiserSummary>(
    `select ia.advertiser_id, a.name, a.logo_asset_id, ia.pricing, ia.pricing_model,
            ia.rate::text as rate, ia.weight, ia.priority
     from instance_advertiser ia join advertiser a on a.id = ia.advertiser_id
     where ia.instance_id = $1 order by ia.priority, a.name`,
    [instanceId],
  );
}

/**
 * Sources with a live match count. The count is the whole point of this screen:
 * "10 products from this feed, 100 from that one" has to be visible while the
 * conditions are being written, not discovered at serve time.
 */
export async function loadSources(instanceId: string): Promise<SourceSummary[]> {
  const rows = await query<Omit<SourceSummary, 'matches'>>(
    `select s.id, s.advertiser_id, a.name as advertiser, s.feed_id, f.name as feed,
            f.type as feed_type, f.status as feed_status, s.name, s.conditions, s.max_products, s.priority
     from instance_source s
     join advertiser a on a.id = s.advertiser_id
     join feed f on f.id = s.feed_id
     where s.instance_id = $1 order by s.priority, a.name`,
    [instanceId],
  );
  const { compileRule } = await import('./rules');
  const out: SourceSummary[] = [];
  for (const r of rows) {
    let matches = 0;
    try {
      const extra = r.conditions ? compileRule(r.conditions as never, 1, 'p.') : null;
      const counts = await query<{ n: string }>(
        `select count(*)::text as n from product p
         where p.feed_id = $1 and p.available${extra ? ` and (${extra.where})` : ''}`,
        [r.feed_id, ...(extra?.params ?? [])],
      );
      matches = Number(counts[0]?.n ?? 0);
    } catch {
      matches = -1; // invalid conditions — surfaced as a warning in the UI
    }
    out.push({ ...r, matches: r.max_products ? Math.min(matches, r.max_products) : matches });
  }
  return out;
}

export async function loadTargeting(instanceId: string): Promise<TargetingRule[]> {
  return query<TargetingRule>(
    `select m.id, m.page_key, m.operator, m.page_value, m.dict_id, d.name as dict_name,
            m.segment, m.target, m.priority
     from kv_mapping m left join kv_dictionary d on d.id = m.dict_id
     where m.instance_id = $1 order by m.priority, m.created_at`,
    [instanceId],
  );
}

export interface Blocker { text: string; step: StepSlug; hard: boolean }

/**
 * What still stands between this widget and going live. Hard blockers are the
 * ones the going-live guard enforces server-side too — this list exists so the
 * reason is visible before the button is pressed, not after it silently
 * refuses.
 */
export function readiness(
  w: Widget,
  advertisers: AdvertiserSummary[],
  sources: SourceSummary[],
  targeting: TargetingRule[],
  feedIssues: { demo: boolean; unhealthy: string[] },
): Blocker[] {
  const b: Blocker[] = [];
  const takeover = w.widget_type === 'takeover';
  if (!advertisers.length) b.push({ text: 'Ingen annoncør på widgetten.', step: 'sources', hard: true });
  if (!takeover && !sources.length) b.push({ text: 'Ingen produktkilder — widgetten har intet at vise.', step: 'sources', hard: true });
  for (const s of sources) {
    if (s.matches < 0) b.push({ text: `Betingelserne på "${s.advertiser} · ${s.feed}" er ugyldige.`, step: 'sources', hard: true });
    else if (s.matches === 0) b.push({ text: `"${s.advertiser} · ${s.feed}" matcher 0 produkter.`, step: 'sources', hard: true });
  }
  if (feedIssues.demo) b.push({ text: 'En kilde peger på demo-feedet. Det må ikke ramme en publisher-side.', step: 'sources', hard: true });
  for (const f of feedIssues.unhealthy) b.push({ text: `Feedet "${f}" er ikke healthy — stale data må ikke renderes.`, step: 'sources', hard: true });
  const priced = advertisers.filter((a) => pricingLabel(a.pricing) !== '');
  if (advertisers.length && priced.length < advertisers.length) {
    b.push({ text: 'Mindst én annoncør mangler prissætning.', step: 'pricing', hard: false });
  }
  // "Ingen targeting" is a legitimate choice: the widget then shows its pool on
  // every load. What is NOT allowed is the ambiguous middle — no rules AND a
  // fallback that hides — because that widget can never render anything.
  const hasDefault = w.fallback_config?.strategy === 'default_products' || w.fallback_config?.unmapped === true;
  if (!takeover && !targeting.length && !hasDefault) {
    b.push({ text: 'Ingen targeting-regler og fallback står på "vis ikke noget" — widgetten vil aldrig rendere. Vælg "Ingen targeting (vis altid)" eller tilføj en regel.', step: 'targeting', hard: true });
  }
  for (const t of targeting) {
    if (t.target?.kind === 'explicit' && !(t.target.product_ids ?? []).length) {
      b.push({ text: `Reglen på "${t.page_key}" skal vise udvalgte produkter, men der er ikke valgt nogen.`, step: 'targeting', hard: true });
    }
  }
  if (!w.placement_code) b.push({ text: 'Intet placement — der er ingen embed-kode at levere.', step: 'launch', hard: true });
  return b;
}

/** Creates the widget's private design template. Layout changes rewrite it. */
export async function createPrivateTemplate(name: string, layout: string, widgetType: string): Promise<string> {
  const rows = await query<{ id: string }>(
    `insert into widget_template (name, layout_type, design_tokens, slot_count, behaviours, widget_type, meta)
     values ($1, $2, '{}'::jsonb, $3::jsonb, '{}'::jsonb, $4, '{"library": false}'::jsonb)
     returning id`,
    [`${name} — design`, layout, JSON.stringify({ default: layout === 'single_card' ? 1 : 3 }), widgetType],
  );
  return rows[0].id;
}

/** Short suffix so two widgets with the same name get distinct placement codes. */
export function codeFor(name: string, instanceId: string): string {
  return placementCode(name, instanceId.slice(0, 6));
}

/** The visual editor's fields. Kept explicit so the form and the code view agree. */
export const TOKEN_FIELDS = [
  { key: 'colorBackground', label: 'Baggrund', type: 'color' },
  { key: 'colorSurface', label: 'Kortflade', type: 'color' },
  { key: 'colorText', label: 'Tekst', type: 'color' },
  { key: 'colorTextSecondary', label: 'Sekundær tekst', type: 'color' },
  { key: 'colorPrice', label: 'Pris', type: 'color' },
  { key: 'colorCtaBg', label: 'CTA-baggrund', type: 'color' },
  { key: 'colorCtaText', label: 'CTA-tekst', type: 'color' },
  { key: 'colorBorder', label: 'Kant', type: 'color' },
  { key: 'colorAccent', label: 'Accent', type: 'color' },
  { key: 'colorBadgeBg', label: 'Badge-baggrund', type: 'color' },
  { key: 'colorBadgeText', label: 'Badge-tekst', type: 'color' },
  { key: 'fontFamily', label: 'Brødtekst-font', type: 'text' },
  { key: 'headingFontFamily', label: 'Overskrift-font', type: 'text' },
  { key: 'fontSizeBase', label: 'Grundstørrelse', type: 'text' },
  { key: 'radius', label: 'Hjørneradius', type: 'text' },
  { key: 'shadow', label: 'Skygge', type: 'text' },
  { key: 'imageRatio', label: 'Billedformat', type: 'text' },
  { key: 'ctaStyle', label: 'CTA-stil', type: 'select', options: ['button', 'link', 'arrow'] },
  { key: 'titleLineClamp', label: 'Titel-linjer', type: 'number' },
] as const;

/** Editable template copy. Everything else the templates render is data. */
export const META_FIELDS = [
  { key: 'sectionHeading', label: 'Sektionsoverskrift', placeholder: 'Vin til aftensmaden' },
  { key: 'copy', label: 'Brødtekst / brand-tekst', placeholder: 'Udvalgt til din opskrift' },
  { key: 'matchLine', label: 'Match-linje (vises kun ved kontekst-match)', placeholder: 'Passer til opskriftens ingredienser' },
  { key: 'ctaLabel', label: 'CTA-tekst', placeholder: 'Se vinen' },
  { key: 'catalogTitle', label: 'Katalog-titel', placeholder: 'Ugens tilbud' },
  { key: 'heroText', label: 'Hero-tekst (native/takeover)', placeholder: 'Alt til haven — nu 30 %' },
  { key: 'ctaUrl', label: 'CTA-link (native uden produkter)', placeholder: 'https://annoncoer.dk/kampagne' },
  { key: 'whyLabel', label: '"Derfor"-label', placeholder: 'Derfor' },
  { key: 'bestMatchLabel', label: 'Bedste match-label', placeholder: 'Bedste match' },
] as const;

/** Colour tokens must be a hex value the browser accepts — the <input type=color> guarantees it. */
export function isHex(v: string): boolean {
  return /^#[0-9a-fA-F]{3,8}$/.test(v);
}

/**
 * Human label for a pricing object. Only the four known models are shown:
 * a pricing blob written by an older seed or an import can carry other keys,
 * and rendering those as if they were price models is worse than saying
 * nothing.
 */
export function pricingLabel(pricing: Record<string, unknown> | null | undefined): string {
  const known = PRICING_MODELS.map((m) => m.id).filter((k) => pricing && k in pricing);
  return known.map((k) => k.toUpperCase()).join(' + ');
}
