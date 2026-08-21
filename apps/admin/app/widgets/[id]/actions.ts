'use server';
// Every mutation the wizard performs. Kept in one module so the step components
// stay presentational and so the guardrails (going live, condition validation)
// live in exactly one place.
import { revalidatePath } from 'next/cache';
import { redirectWithBasePath } from '@/lib/base-path';
import { query } from '@/lib/db';
import { compileRule, type RuleConditions, type RuleNode } from '@/lib/rules';
import { storeUpload } from '@/lib/assets';
import { suggestStyle } from '@/lib/ai-style';
import { codeFor, createPrivateTemplate, loadAdvertisers, loadSources, loadTargeting, loadWidget, readiness, TOKEN_FIELDS, isHex } from '@/lib/wizard';
import type { DesignTokens } from '@/lib/serve-types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(fd: FormData, field = 'id'): string {
  const v = String(fd.get(field) ?? '');
  if (!UUID.test(v)) throw new Error(`Ugyldigt ${field}`);
  return v;
}
function str(fd: FormData, field: string): string {
  return String(fd.get(field) ?? '').trim();
}
async function back(wid: string, step: string, msg?: { error?: string; ok?: string }): Promise<void> {
  const sp = new URLSearchParams({ step });
  if (msg?.error) sp.set('error', msg.error);
  if (msg?.ok) sp.set('ok', msg.ok);
  revalidatePath(`/widgets/${wid}`);
  await redirectWithBasePath(`/widgets/${wid}?${sp}`);
}

/** Advances the "furthest step reached" marker so the stepper can show progress. */
async function touchStep(wid: string, step: number): Promise<void> {
  await query('update widget_instance set wizard_step = greatest(wizard_step, $2), updated_at = now() where id = $1', [wid, step]);
}

// ---------------------------------------------------------------- create

export async function createWidget(fd: FormData): Promise<void> {
  const name = str(fd, 'name');
  const siteId = id(fd, 'site_id');
  const widgetType = str(fd, 'widget_type') === 'takeover' ? 'takeover' : 'product_match';
  if (!name) await redirectWithBasePath('/widgets?error=Navn+mangler');

  const layout = widgetType === 'takeover' ? 'forum_post' : 'recipe_section';
  const templateId = await createPrivateTemplate(name, layout, widgetType);
  const rows = await query<{ id: string }>(
    `insert into widget_instance (template_id, site_id, name, widget_type, mode, wizard_step, status)
     values ($1, $2, $3, $4, 'exclusive', 1, 'draft') returning id`,
    [templateId, siteId, name, widgetType],
  );
  const wid = rows[0].id;
  // One placement per widget, created up front: the embed code is the whole
  // point of the wizard, so it must exist from the first step rather than being
  // a separate object someone has to remember to create.
  await query(
    `insert into placement (site_id, name, code, rules, default_instance_id, status)
     values ($1, $2, $3, '[]'::jsonb, $4, 'live')`,
    [siteId, name, codeFor(name, wid), wid],
  );
  revalidatePath('/widgets');
  await redirectWithBasePath(`/widgets/${wid}?step=sources`);
}

// ---------------------------------------------------------------- step 1

export async function saveType(fd: FormData): Promise<void> {
  const wid = id(fd);
  const name = str(fd, 'name');
  const widgetType = str(fd, 'widget_type') === 'takeover' ? 'takeover' : 'product_match';
  await query(
    `update widget_instance set name = coalesce(nullif($2, ''), name), widget_type = $3, updated_at = now() where id = $1`,
    [wid, name, widgetType],
  );
  if (name) {
    await query(`update placement set name = $2, updated_at = now() where default_instance_id = $1`, [wid, name]);
  }
  await touchStep(wid, 2);
  await back(wid, 'sources');
}

// ---------------------------------------------------------------- step 2: sources

export async function addSource(fd: FormData): Promise<void> {
  const wid = id(fd);
  const feedId = id(fd, 'feed_id');
  const cap = Number(str(fd, 'max_products'));
  const feeds = await query<{ advertiser_id: string; name: string }>(
    'select advertiser_id, name from feed where id = $1',
    [feedId],
  );
  const feed = feeds[0];
  if (!feed) await back(wid, 'sources', { error: 'Feedet findes ikke.' });

  // The advertiser comes from the feed, never from the form: a source whose
  // advertiser does not own the feed would attribute another advertiser's
  // clicks, and the resolver would drop it anyway.
  await query(
    `insert into instance_advertiser (instance_id, advertiser_id, pricing_model, priority)
     values ($1, $2, 'cpc', (select coalesce(max(priority), -1) + 1 from instance_advertiser where instance_id = $1))
     on conflict (instance_id, advertiser_id) do nothing`,
    [wid, feed.advertiser_id],
  );
  await query(
    `insert into instance_source (instance_id, advertiser_id, feed_id, name, max_products, priority)
     values ($1, $2, $3, $4, $5, (select coalesce(max(priority), -1) + 1 from instance_source where instance_id = $1))`,
    [wid, feed.advertiser_id, feedId, str(fd, 'name') || feed.name, Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : null],
  );
  // More than one advertiser contributing means this is a shared widget.
  await query(
    `update widget_instance set mode = case
        when (select count(distinct advertiser_id) from instance_source where instance_id = $1) > 1
        then 'shared' else 'exclusive' end, updated_at = now()
     where id = $1`,
    [wid],
  );
  await touchStep(wid, 2);
  await back(wid, 'sources');
}

export async function removeSource(fd: FormData): Promise<void> {
  const wid = id(fd);
  const sid = id(fd, 'source_id');
  const rows = await query<{ advertiser_id: string }>(
    'delete from instance_source where id = $1 and instance_id = $2 returning advertiser_id',
    [sid, wid],
  );
  // Drop the advertiser from the widget when its last source goes: an
  // advertiser row with no products would still claim branding and pricing.
  if (rows[0]) {
    await query(
      `delete from instance_advertiser ia
       where ia.instance_id = $1 and ia.advertiser_id = $2
         and not exists (select 1 from instance_source s where s.instance_id = $1 and s.advertiser_id = $2)`,
      [wid, rows[0].advertiser_id],
    );
  }
  await query(
    `update widget_instance set mode = case
        when (select count(distinct advertiser_id) from instance_source where instance_id = $1) > 1
        then 'shared' else 'exclusive' end, updated_at = now()
     where id = $1`,
    [wid],
  );
  await back(wid, 'sources');
}

export async function setSourceCap(fd: FormData): Promise<void> {
  const wid = id(fd);
  const cap = Number(str(fd, 'max_products'));
  await query(
    'update instance_source set max_products = $3, updated_at = now() where id = $1 and instance_id = $2',
    [id(fd, 'source_id'), wid, Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : null],
  );
  await back(wid, 'sources');
}

/** Reads a source's conditions as a flat AND list, which is what the UI edits. */
async function sourceConditions(sourceId: string, instanceId: string): Promise<RuleNode[]> {
  const rows = await query<{ conditions: RuleConditions | null }>(
    'select conditions from instance_source where id = $1 and instance_id = $2',
    [sourceId, instanceId],
  );
  const c = rows[0]?.conditions;
  if (!c) return [];
  if (Array.isArray(c)) return c;
  return c.all ?? c.any ?? [];
}

async function writeConditions(sourceId: string, instanceId: string, list: RuleNode[]): Promise<void> {
  const value = list.length ? JSON.stringify({ all: list }) : null;
  await query(
    'update instance_source set conditions = $3::jsonb, updated_at = now() where id = $1 and instance_id = $2',
    [sourceId, instanceId, value],
  );
}

export async function addCondition(fd: FormData): Promise<void> {
  const wid = id(fd);
  const sid = id(fd, 'source_id');
  const field = str(fd, 'field');
  const operator = str(fd, 'operator');
  const raw = str(fd, 'value');
  const leaf = {
    field,
    operator: operator as 'equals',
    value: operator === 'in' ? raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) : raw,
  };
  const list = [...(await sourceConditions(sid, wid)), leaf];
  try {
    compileRule({ all: list }, 1, 'p.'); // reject unknown fields / bad numerics before saving
  } catch (e) {
    await back(wid, 'sources', { error: e instanceof Error ? e.message : 'Ugyldig betingelse' });
  }
  await writeConditions(sid, wid, list);
  await back(wid, 'sources');
}

export async function removeCondition(fd: FormData): Promise<void> {
  const wid = id(fd);
  const sid = id(fd, 'source_id');
  const idx = Number(str(fd, 'idx'));
  const list = await sourceConditions(sid, wid);
  if (Number.isInteger(idx) && idx >= 0 && idx < list.length) list.splice(idx, 1);
  await writeConditions(sid, wid, list);
  await back(wid, 'sources');
}

export async function setConditionsJson(fd: FormData): Promise<void> {
  const wid = id(fd);
  const sid = id(fd, 'source_id');
  const raw = str(fd, 'conditions');
  if (!raw) {
    await query('update instance_source set conditions = null, updated_at = now() where id = $1 and instance_id = $2', [sid, wid]);
    await back(wid, 'sources');
  }
  let parsed: RuleConditions;
  try {
    parsed = JSON.parse(raw) as RuleConditions;
    compileRule(parsed, 1, 'p.');
  } catch (e) {
    await back(wid, 'sources', { error: e instanceof Error ? e.message : 'Ugyldig JSON' });
  }
  await query(
    'update instance_source set conditions = $3::jsonb, updated_at = now() where id = $1 and instance_id = $2',
    [sid, wid, JSON.stringify(parsed!)],
  );
  await back(wid, 'sources');
}

// ---------------------------------------------------------------- step 3: pricing

export async function savePricing(fd: FormData): Promise<void> {
  const wid = id(fd);
  const advertiserId = id(fd, 'advertiser_id');
  const pricing: Record<string, unknown> = {};
  const num = (field: string): number | null => {
    const v = Number(str(fd, field).replace(',', '.'));
    return Number.isFinite(v) && v >= 0 ? v : null;
  };
  if (fd.get('use_cpc') === 'on') pricing.cpc = { rate: num('cpc_rate'), currency: 'DKK' };
  if (fd.get('use_cpm') === 'on') pricing.cpm = { rate: num('cpm_rate'), currency: 'DKK' };
  if (fd.get('use_fixed') === 'on') pricing.fixed = { amount: num('fixed_amount'), currency: 'DKK', period: str(fd, 'fixed_period') || null };
  if (fd.get('use_affiliate') === 'on') {
    pricing.affiliate = {
      network: str(fd, 'aff_network') || null,
      commission: str(fd, 'aff_commission') || null,
      // {url} is the product's own link, {click_id} our click id — substituted
      // by the redirect so the network can attribute the click.
      deeplink_template: str(fd, 'aff_deeplink') || null,
    };
  }
  // The primary model drives reporting; combinations keep their detail in the
  // jsonb. Ordered by what we would bill first.
  const primary = (['cpc', 'cpm', 'affiliate', 'fixed'] as const).find((k) => k in pricing) ?? 'fixed';
  const rate =
    primary === 'cpc' ? (pricing.cpc as { rate: number | null }).rate
    : primary === 'cpm' ? (pricing.cpm as { rate: number | null }).rate
    : primary === 'fixed' ? (pricing.fixed as { amount: number | null } | undefined)?.amount ?? null
    : null;
  const weight = Number(str(fd, 'weight'));

  await query(
    `update instance_advertiser set pricing = $3::jsonb, pricing_model = $4, rate = $5,
            weight = $6, updated_at = now()
     where instance_id = $1 and advertiser_id = $2`,
    [wid, advertiserId, JSON.stringify(pricing), primary, rate, Number.isFinite(weight) && weight > 0 ? Math.floor(weight) : null],
  );
  await touchStep(wid, 3);
  await back(wid, 'pricing', { ok: 'Priser gemt.' });
}

/**
 * The widget's design must live on a template only this widget uses. Widgets
 * created before the wizard (or from a library template) may point at a shared
 * row; forking it on first edit stops one widget's restyling from silently
 * changing another's.
 */
async function privateTemplate(wid: string, templateId: string): Promise<string> {
  const rows = await query<{ library: boolean; used: string }>(
    `select coalesce((meta->>'library')::boolean, false) as library,
            (select count(*) from widget_instance wi where wi.template_id = $1)::text as used
     from widget_template where id = $1`,
    [templateId],
  );
  const row = rows[0];
  if (row && !row.library && Number(row.used) <= 1) return templateId;
  const copy = await query<{ id: string }>(
    `insert into widget_template (name, layout_type, design_tokens, slot_count, behaviours, widget_type, meta, created_from_instance_id)
     select name || ' — kopi', layout_type, design_tokens, slot_count, behaviours, widget_type,
            '{"library": false}'::jsonb, $2
     from widget_template where id = $1 returning id`,
    [templateId, wid],
  );
  await query('update widget_instance set template_id = $2, updated_at = now() where id = $1', [wid, copy[0].id]);
  return copy[0].id;
}

/** A widget with no placement has no embed code, so the launch step can create one. */
export async function ensurePlacement(fd: FormData): Promise<void> {
  const wid = id(fd);
  const w = await loadWidget(wid);
  if (!w) await back(wid, 'launch', { error: 'Widget ikke fundet' });
  if (w!.placement_code) await back(wid, 'launch', { ok: 'Placement findes allerede.' });
  await query(
    `insert into placement (site_id, name, code, rules, default_instance_id, status)
     values ($1, $2, $3, '[]'::jsonb, $4, 'live')`,
    [w!.site_id, w!.name, codeFor(w!.name, wid), wid],
  );
  await back(wid, 'launch', { ok: 'Placement og embed-kode oprettet.' });
}

// ---------------------------------------------------------------- step 4: design

function tokensFromForm(fd: FormData, existing: DesignTokens): DesignTokens {
  const out: DesignTokens = { ...existing };
  for (const f of TOKEN_FIELDS) {
    const raw = String(fd.get(`t_${f.key}`) ?? '').trim();
    const key = f.key as keyof DesignTokens;
    // A colour picker always posts a value, so an untouched field would
    // otherwise save #ffffff over every colour — white text on a white card.
    // The token only applies when its checkbox says so.
    if (f.type === 'color' && fd.get(`use_${f.key}`) !== 'on') {
      delete out[key];
      continue;
    }
    if (!raw) {
      delete out[key];
      continue;
    }
    if (f.type === 'color' && !isHex(raw)) continue;
    if (f.type === 'number') {
      const n = Number(raw);
      if (Number.isFinite(n)) (out as Record<string, unknown>)[f.key] = Math.round(n);
      continue;
    }
    (out as Record<string, unknown>)[f.key] = raw;
  }
  return out;
}

export async function saveDesign(fd: FormData): Promise<void> {
  const wid = id(fd);
  const w = await loadWidget(wid);
  if (!w) await back(wid, 'design', { error: 'Widget ikke fundet' });

  const layout = str(fd, 'layout') || w!.layout_type;
  const slots = Number(str(fd, 'slots'));
  const tokens = tokensFromForm(fd, w!.design_tokens ?? {});
  const customCss = str(fd, 'custom_css');
  if (customCss) tokens.customCss = customCss;
  else delete tokens.customCss;

  const tid = await privateTemplate(wid, w!.template_id);
  await query(
    `update widget_template set layout_type = $2, design_tokens = $3::jsonb, slot_count = $4::jsonb, updated_at = now()
     where id = $1`,
    [tid, layout, JSON.stringify(tokens), JSON.stringify({ default: Number.isFinite(slots) && slots > 0 ? Math.min(12, Math.floor(slots)) : 3 })],
  );

  // Template copy lives on the instance so a shared library template stays reusable.
  const meta: Record<string, string> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith('m_') && typeof value === 'string' && value.trim()) meta[key.slice(2)] = value.trim();
  }
  const overrides = { ...(w!.token_overrides ?? {}) } as Record<string, unknown>;
  if (Object.keys(meta).length) overrides.__meta = meta;
  else delete overrides.__meta;
  await query('update widget_instance set token_overrides = $2::jsonb, updated_at = now() where id = $1', [wid, JSON.stringify(overrides)]);
  await touchStep(wid, 4);
  await back(wid, 'design', { ok: 'Design gemt.' });
}

export async function saveDesignCode(fd: FormData): Promise<void> {
  const wid = id(fd);
  const w = await loadWidget(wid);
  if (!w) await back(wid, 'design', { error: 'Widget ikke fundet' });
  let tokens: DesignTokens;
  try {
    tokens = JSON.parse(str(fd, 'tokens_json') || '{}') as DesignTokens;
    if (typeof tokens !== 'object' || Array.isArray(tokens)) throw new Error('Tokens skal være et JSON-objekt');
  } catch (e) {
    await back(wid, 'design', { error: e instanceof Error ? e.message : 'Ugyldig JSON' });
  }
  const css = str(fd, 'custom_css');
  if (css) tokens!.customCss = css;
  else delete tokens!.customCss;
  const tid = await privateTemplate(wid, w!.template_id);
  await query('update widget_template set design_tokens = $2::jsonb, updated_at = now() where id = $1', [tid, JSON.stringify(tokens!)]);
  await back(wid, 'design', { ok: 'Kode gemt.' });
}

export async function runAiStyle(fd: FormData): Promise<void> {
  const wid = id(fd);
  const w = await loadWidget(wid);
  if (!w) await back(wid, 'design', { error: 'Widget ikke fundet' });
  const pageUrl = str(fd, 'page_url');
  if (!pageUrl) await back(wid, 'design', { error: 'Indsæt en URL til siden.' });

  let shot: { mediaType: string; base64: string } | undefined;
  const file = fd.get('screenshot');
  if (file instanceof File && file.size > 0) {
    if (file.size > 5 * 1024 * 1024) await back(wid, 'design', { error: 'Screenshottet er over 5 MB.' });
    shot = { mediaType: file.type || 'image/png', base64: Buffer.from(await file.arrayBuffer()).toString('base64') };
    // Kept so the design step can show what the styling was derived from.
    try {
      const assetId = await storeUpload(file);
      if (assetId) {
        await query(
          `update widget_instance set token_overrides = jsonb_set(token_overrides, '{__shot}', to_jsonb($2::text), true), updated_at = now() where id = $1`,
          [wid, assetId],
        );
      }
    } catch {
      // A screenshot we cannot store is still usable for this one request.
    }
  }

  // The success redirect must live OUTSIDE the try: redirect() aborts by
  // throwing, and a catch around it would report the styling as failed.
  let applied: string | null = null;
  try {
    const suggestion = await suggestStyle({
      pageUrl,
      screenshot: shot,
      areaNote: str(fd, 'area_note'),
      widgetType: w!.widget_type,
    });
    const applyLayout = fd.get('apply_layout') === 'on' && suggestion.layout;
    await query(
      `update widget_template
       set design_tokens = design_tokens || $2::jsonb,
           layout_type = coalesce($3, layout_type), updated_at = now()
       where id = $1`,
      [await privateTemplate(wid, w!.template_id), JSON.stringify(suggestion.tokens), applyLayout ? suggestion.layout : null],
    );
    await query(
      `update widget_instance
       set token_overrides = jsonb_set(token_overrides, '{__ai}', $2::jsonb, true), updated_at = now()
       where id = $1`,
      [wid, JSON.stringify({ rationale: suggestion.rationale, palette: suggestion.palette, fonts: suggestion.fonts, url: pageUrl, notes: suggestion.notes })],
    );
    applied = 'AI-styling anvendt — se begrundelsen nedenfor.';
  } catch (e) {
    await back(wid, 'design', { error: e instanceof Error ? e.message : 'AI-styling fejlede' });
  }
  await back(wid, 'design', { ok: applied ?? 'AI-styling anvendt.' });
}

export async function saveAsTemplate(fd: FormData): Promise<void> {
  const wid = id(fd);
  const w = await loadWidget(wid);
  if (!w) await back(wid, 'design', { error: 'Widget ikke fundet' });
  const name = str(fd, 'template_name') || `${w!.name} (skabelon)`;
  await query(
    `insert into widget_template (name, layout_type, design_tokens, slot_count, behaviours,
                                  created_from_instance_id, widget_type, meta)
     values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, '{"library": true}'::jsonb)`,
    [
      name, w!.layout_type, JSON.stringify(w!.design_tokens ?? {}), JSON.stringify(w!.slot_count ?? { default: 3 }),
      JSON.stringify(w!.behaviours ?? {}), wid, w!.widget_type,
    ],
  );
  revalidatePath('/templates');
  await back(wid, 'design', { ok: `Gemt som skabelon "${name}".` });
}

export async function applyTemplate(fd: FormData): Promise<void> {
  const wid = id(fd);
  const w = await loadWidget(wid);
  if (!w) await back(wid, 'design', { error: 'Widget ikke fundet' });
  const templateId = id(fd, 'template_id');
  const src = await query<{ layout_type: string; design_tokens: DesignTokens; slot_count: unknown; behaviours: unknown }>(
    'select layout_type, design_tokens, slot_count, behaviours from widget_template where id = $1',
    [templateId],
  );
  if (!src[0]) await back(wid, 'design', { error: 'Skabelonen findes ikke' });
  // Copy INTO the widget's own template row rather than pointing at the shared
  // one: editing the design afterwards must never change other widgets.
  await query(
    `update widget_template set layout_type = $2, design_tokens = $3::jsonb, slot_count = $4::jsonb,
            behaviours = $5::jsonb, updated_at = now()
     where id = $1`,
    [await privateTemplate(wid, w!.template_id), src[0].layout_type, JSON.stringify(src[0].design_tokens ?? {}), JSON.stringify(src[0].slot_count ?? { default: 3 }), JSON.stringify(src[0].behaviours ?? {})],
  );
  await back(wid, 'design', { ok: 'Skabelon anvendt.' });
}

// ---------------------------------------------------------------- step 5: targeting

export async function addTargeting(fd: FormData): Promise<void> {
  const wid = id(fd);
  const pageKey = str(fd, 'page_key');
  const operator = str(fd, 'operator');
  const action = str(fd, 'action');
  if (!pageKey || !['eq', 'contains', 'dict'].includes(operator)) await back(wid, 'targeting', { error: 'Vælg key og operator.' });

  const pageValue = str(fd, 'page_value') || str(fd, 'page_value_free');
  const dictId = str(fd, 'dict_id');
  const segment = str(fd, 'segment');
  if (operator === 'dict' && (!dictId || !segment)) {
    await back(wid, 'targeting', { error: 'Ordbogsmatch kræver både ordbog og segment.' });
  }
  if (operator !== 'dict' && !pageValue) await back(wid, 'targeting', { error: 'Angiv en værdi.' });

  let target: Record<string, unknown>;
  switch (action) {
    case 'hide':
      target = { kind: 'hide' };
      break;
    case 'all':
      target = { kind: 'all' };
      break;
    case 'rule':
      if (!UUID.test(str(fd, 'rule_id'))) await back(wid, 'targeting', { error: 'Vælg en produktregel.' });
      target = { kind: 'rule', rule_id: str(fd, 'rule_id') };
      break;
    case 'explicit':
      target = { kind: 'explicit', product_ids: [] };
      break;
    default: {
      const field = str(fd, 'filter_field');
      const op = str(fd, 'filter_operator') || 'equals';
      const raw = str(fd, 'filter_value');
      const leaf = {
        field,
        operator: op,
        value: op === 'in' ? raw.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) : raw,
      };
      try {
        compileRule({ all: [leaf as never] }, 1, 'p.');
      } catch (e) {
        await back(wid, 'targeting', { error: e instanceof Error ? e.message : 'Ugyldigt filter' });
      }
      target = { kind: 'filter', conditions: { all: [leaf] } };
    }
  }

  await query(
    `insert into kv_mapping (instance_id, page_key, operator, page_value, dict_id, segment, target, priority)
     values ($1, $2, $3, nullif($4, ''), nullif($5, '')::uuid, nullif($6, ''), $7::jsonb,
             (select coalesce(max(priority), -1) + 1 from kv_mapping where instance_id = $1))`,
    [wid, pageKey, operator, operator === 'dict' ? '' : pageValue, dictId, segment, JSON.stringify(target)],
  );
  await touchStep(wid, 5);
  await back(wid, 'targeting');
}

export async function removeTargeting(fd: FormData): Promise<void> {
  const wid = id(fd);
  await query('delete from kv_mapping where id = $1 and instance_id = $2', [id(fd, 'mapping_id'), wid]);
  await back(wid, 'targeting');
}

export async function moveTargeting(fd: FormData): Promise<void> {
  const wid = id(fd);
  const mid = id(fd, 'mapping_id');
  const dir = str(fd, 'dir') === 'up' ? -1 : 1;
  const rows = await query<{ id: string; priority: number }>(
    'select id, priority from kv_mapping where instance_id = $1 order by priority, created_at',
    [wid],
  );
  const i = rows.findIndex((r) => r.id === mid);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= rows.length) await back(wid, 'targeting');
  // Rewrite the whole ladder: stored priorities may be duplicated or sparse
  // after edits, so swapping two values alone would not reorder anything.
  const order = rows.map((r) => r.id);
  [order[i], order[j]] = [order[j], order[i]];
  for (let k = 0; k < order.length; k++) {
    await query('update kv_mapping set priority = $2, updated_at = now() where id = $1', [order[k], k]);
  }
  await back(wid, 'targeting');
}

export async function pickProduct(fd: FormData): Promise<void> {
  const wid = id(fd);
  const mid = id(fd, 'mapping_id');
  const pid = id(fd, 'product_id');
  const rows = await query<{ target: { kind: string; product_ids?: string[] } }>(
    'select target from kv_mapping where id = $1 and instance_id = $2',
    [mid, wid],
  );
  const target = rows[0]?.target;
  if (!target || target.kind !== 'explicit') await back(wid, 'targeting', { error: 'Reglen viser ikke udvalgte produkter.' });
  const set = new Set(target.product_ids ?? []);
  if (str(fd, 'op') === 'remove') set.delete(pid);
  else set.add(pid);
  await query(
    'update kv_mapping set target = $3::jsonb, updated_at = now() where id = $1 and instance_id = $2',
    [mid, wid, JSON.stringify({ kind: 'explicit', product_ids: [...set] })],
  );
  revalidatePath(`/widgets/${wid}`);
  await redirectWithBasePath(`/widgets/${wid}?step=targeting&pick=${mid}`);
}

export async function saveFallback(fd: FormData): Promise<void> {
  const wid = id(fd);
  const mode = str(fd, 'fallback');
  let config: Record<string, unknown>;
  if (mode === 'all') config = { strategy: 'default_products', target: { kind: 'all' } };
  else if (mode === 'rule' && UUID.test(str(fd, 'rule_id'))) {
    config = { strategy: 'default_products', target: { kind: 'rule', rule_id: str(fd, 'rule_id') } };
  } else config = { strategy: 'hide' };
  await query('update widget_instance set fallback_config = $2::jsonb, updated_at = now() where id = $1', [wid, JSON.stringify(config)]);
  await back(wid, 'targeting', { ok: 'Fallback gemt.' });
}

// ---------------------------------------------------------------- step 6: launch

export async function setStatus(fd: FormData): Promise<void> {
  const wid = id(fd);
  const wanted = str(fd, 'status');
  if (!['draft', 'live', 'paused', 'archived'].includes(wanted)) await back(wid, 'launch', { error: 'Ukendt status' });

  if (wanted === 'live') {
    // Going live is gated on the same checks the launch step displays, verified
    // here so a stale page or a crafted request cannot bypass them.
    const w = await loadWidget(wid);
    if (!w) return await back(wid, 'launch', { error: 'Widget ikke fundet' });
    const [advertisers, sources, targeting] = await Promise.all([
      loadAdvertisers(wid), loadSources(wid), loadTargeting(wid),
    ]);
    const issues = await query<{ demo: boolean; name: string; status: string; type: string }>(
      `select f.source_url like '%/api/demo-feed%' as demo, f.name, f.status, f.type
       from instance_source s join feed f on f.id = s.feed_id where s.instance_id = $1`,
      [wid],
    );
    const blockers = readiness(w, advertisers, sources, targeting, {
      demo: issues.some((i) => i.demo),
      unhealthy: issues.filter((i) => i.type !== 'manual' && i.status !== 'healthy').map((i) => i.name),
    }).filter((b) => b.hard);
    if (blockers.length) {
      await back(wid, 'launch', { error: `Kan ikke gå live: ${blockers.map((b) => b.text).join(' ')}` });
    }
  }
  await query('update widget_instance set status = $2, updated_at = now() where id = $1', [wid, wanted]);
  await touchStep(wid, 6);
  revalidatePath('/widgets');
  await back(wid, 'launch', { ok: wanted === 'live' ? 'Widgetten er live.' : `Status sat til ${wanted}.` });
}

export async function deleteWidget(fd: FormData): Promise<void> {
  const wid = id(fd);
  const w = await loadWidget(wid);
  await query('delete from placement where default_instance_id = $1', [wid]);
  await query('delete from widget_instance where id = $1', [wid]);
  // The private design template goes with it; library templates are untouched.
  if (w) await query(`delete from widget_template where id = $1 and coalesce((meta->>'library')::boolean, false) = false`, [w.template_id]);
  revalidatePath('/widgets');
  await redirectWithBasePath('/widgets');
}
