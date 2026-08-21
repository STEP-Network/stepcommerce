// Instance detail: KV → product mappings (Level B), bulk paste import,
// token/meta overrides, status. (spec §5B, §11)
import { revalidatePath } from 'next/cache';
import { query, sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function InstanceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  async function addMapping(formData: FormData) {
    'use server';
    const pageKey = String(formData.get('page_key') ?? '').trim();
    const operator = String(formData.get('operator') ?? 'eq');
    const pageValue = String(formData.get('page_value') ?? '').trim() || null;
    const dictId = String(formData.get('dict_id') ?? '') || null;
    const segment = String(formData.get('segment') ?? '').trim() || null;
    const ruleId = String(formData.get('rule_id') ?? '') || null;
    const priority = Number(formData.get('priority') ?? 0);
    if (!pageKey || !ruleId) return;
    // An incomplete mapping never matches anything and does so silently: a dict
    // mapping without dict_id/segment, or an eq/contains without a value
    // (contains with '' would match every page that merely has the key).
    if (operator === 'dict' && (!dictId || !segment)) return;
    if (operator !== 'dict' && !pageValue) return;
    await sql`
      insert into kv_mapping (instance_id, page_key, operator, page_value, dict_id, segment, target, priority)
      values (${id}, ${pageKey}, ${operator}, ${pageValue}, ${dictId}, ${segment},
              ${JSON.stringify({ kind: 'rule', rule_id: ruleId })}, ${priority})`;
    revalidatePath(`/instances/${id}`);
  }

  async function bulkImport(formData: FormData) {
    'use server';
    // Paste-in bulk import (spec §3 kv_mapping): "page_value<TAB or ;>rule_id" per line.
    const pageKey = String(formData.get('page_key') ?? '').trim();
    const operator = String(formData.get('operator') ?? 'eq');
    const bulk = String(formData.get('bulk') ?? '');
    if (!pageKey) return;
    let priority = 100;
    for (const line of bulk.split('\n')) {
      const [value, ruleId] = line.split(/[\t;]/).map((s) => s?.trim());
      if (!value || !ruleId) continue;
      await sql`
        insert into kv_mapping (instance_id, page_key, operator, page_value, target, priority)
        values (${id}, ${pageKey}, ${operator}, ${value}, ${JSON.stringify({ kind: 'rule', rule_id: ruleId })}, ${priority++})`;
    }
    revalidatePath(`/instances/${id}`);
  }

  async function removeMapping(formData: FormData) {
    'use server';
    await sql`delete from kv_mapping where id = ${String(formData.get('mid'))} and instance_id = ${id}`;
    revalidatePath(`/instances/${id}`);
  }

  async function saveOverrides(formData: FormData) {
    'use server';
    const overrides = JSON.parse(String(formData.get('token_overrides') ?? '{}'));
    const fallback = JSON.parse(String(formData.get('fallback_config') ?? '{"strategy":"hide"}'));
    let status = String(formData.get('status') ?? 'draft');
    if (status === 'live') {
      // Going live is the one irreversible-feeling action here, so it is gated:
      // an instance with no mappings and no explicit default set would serve its
      // whole catalogue on every matching page, and a demo feed must never
      // reach a publisher.
      const [check] = await query<{ mappings: string; demo: boolean; feed_ok: boolean }>(
        `select (select count(*) from kv_mapping m where m.instance_id = wi.id)::text as mappings,
                coalesce(bool_or(f.source_url like '%/api/demo-feed%'), false) as demo,
                coalesce(bool_or(f.status = 'healthy'), false) as feed_ok
         from widget_instance wi
         join instance_advertiser ia on ia.instance_id = wi.id
         left join feed f on f.advertiser_id = ia.advertiser_id
         where wi.id = $1 group by wi.id`,
        [id],
      );
      const hasDefault = fallback?.strategy === 'default_products' || fallback?.unmapped === true;
      if (check && (check.demo || (Number(check.mappings) === 0 && !hasDefault) || !check.feed_ok)) {
        status = 'draft';
      }
    }
    await sql`
      update widget_instance
      set token_overrides = ${JSON.stringify(overrides)}, fallback_config = ${JSON.stringify(fallback)},
          status = ${status}, updated_at = now()
      where id = ${id}`;
    revalidatePath(`/instances/${id}`);
  }

  const instances = await query<{
    id: string; name: string; status: string; template: string; layout_type: string; site: string; site_id: string;
    advertiser: string; advertiser_id: string; token_overrides: Record<string, unknown>; fallback_config: Record<string, unknown>;
  }>(
    `select wi.id, wi.name, wi.status, wt.name as template, wt.layout_type, s.domain as site, s.id as site_id,
            a.name as advertiser, a.id as advertiser_id, wi.token_overrides, wi.fallback_config
     from widget_instance wi
     join widget_template wt on wt.id = wi.template_id
     join site s on s.id = wi.site_id
     join instance_advertiser ia on ia.instance_id = wi.id
     join advertiser a on a.id = ia.advertiser_id
     where wi.id = $1`,
    [id],
  );
  const inst = instances[0];
  if (!inst) return <h1>Instans ikke fundet</h1>;

  const mappings = await query<{ id: string; page_key: string; operator: string; page_value: string | null; segment: string | null; dict: string | null; target: { rule_id?: string }; priority: number }>(
    `select m.id, m.page_key, m.operator, m.page_value, m.segment, d.name as dict, m.target, m.priority
     from kv_mapping m left join kv_dictionary d on d.id = m.dict_id
     where m.instance_id = $1 order by m.priority`,
    [id],
  );
  // The rule list MUST be scoped to this instance's advertiser: an exclusive
  // widget that serves a competitor's products (while attributing the clicks to
  // this advertiser) is the worst failure this UI can cause, and a name-only
  // dropdown listing every advertiser's "Pairing: fisk" makes it a single
  // mis-click. The resolver enforces the same boundary server-side.
  const [rules, dicts] = await Promise.all([
    query<{ id: string; name: string; feed: string }>(
      `select pr.id, pr.name, f.name as feed
       from product_rule pr join feed f on f.id = pr.feed_id
       where f.advertiser_id = $1 order by pr.name`,
      [inst.advertiser_id],
    ),
    query<{ id: string; name: string }>('select id, name from kv_dictionary where site_id = $1 order by name', [inst.site_id]),
  ]);

  return (
    <>
      <h1>{inst.name} <span className={`status ${inst.status}`}>{inst.status}</span></h1>
      <p className="muted">{inst.template} (<code>{inst.layout_type}</code>) · {inst.site} · {inst.advertiser} · <code>{inst.id}</code></p>

      <h2>KV → produkt-mappings (evalueres i prioritetsrækkefølge)</h2>
      <table>
        <thead><tr><th>Prio</th><th>Page-key</th><th>Operator</th><th>Værdi / segment</th><th>Ordbog</th><th>Regel</th><th></th></tr></thead>
        <tbody>
          {mappings.length === 0 && <tr><td colSpan={7} className="muted">Ingen mappings — instansens default-produktkilde bruges.</td></tr>}
          {mappings.map((m) => (
            <tr key={m.id}>
              <td>{m.priority}</td><td><code>{m.page_key}</code></td><td><code>{m.operator}</code></td>
              <td>{m.operator === 'dict' ? `segment: ${m.segment}` : m.page_value}</td>
              <td>{m.dict ?? '—'}</td>
              <td><code>{rules.find((r) => r.id === m.target?.rule_id)?.name ?? m.target?.rule_id}</code></td>
              <td><form action={removeMapping}><input type="hidden" name="mid" value={m.id} /><button className="small">Slet</button></form></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Tilføj mapping</h2>
      <form className="panel" action={addMapping}>
        <label>Page-key<input name="page_key" required placeholder="mv_ingredients" /></label>
        <label>Operator
          <select name="operator">
            <option value="eq">eq — værdien er lig med</option>
            <option value="contains">contains — værdien indeholder</option>
            <option value="dict">dict — ordbogsmatch på multi-value key</option>
          </select>
        </label>
        <label>Page-value (eq/contains)<input name="page_value" /></label>
        <label>Ordbog (dict)<select name="dict_id"><option value="">—</option>{dicts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
        <label>Segment (dict — ordbogen skal producere dette segment)<input name="segment" placeholder="svinekød" /></label>
        <label>Produktregel (kun {inst.advertiser}s egne)
          <select name="rule_id" required>
            {rules.length === 0 && <option value="">— ingen regler for denne advertiser —</option>}
            {rules.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.feed})</option>)}
          </select>
        </label>
        <label>Prioritet<input name="priority" type="number" defaultValue={0} /></label>
        <button>Tilføj</button>
      </form>

      <h2>Bulk-import (page_value ; rule_id — én pr. linje)</h2>
      <form className="panel" action={bulkImport}>
        <label>Page-key<input name="page_key" required /></label>
        <label>Operator<select name="operator"><option value="eq">eq</option><option value="contains">contains</option></select></label>
        <label>Linjer<textarea name="bulk" placeholder={'xbox;<rule-uuid>\nplaystation;<rule-uuid>'} /></label>
        <button>Importér</button>
      </form>

      <h2>Overrides, fallback &amp; status</h2>
      <form className="panel" action={saveOverrides}>
        <label>Token-overrides (JSON — brug nøglen &quot;__meta&quot; til template-meta: sectionHeading, copy, matchLine, ctaLabel …)
          <textarea name="token_overrides" defaultValue={JSON.stringify(inst.token_overrides, null, 2)} />
        </label>
        <label>Fallback (JSON — {'{"strategy":"hide"}'} eller {'{"strategy":"default_products","product_source":{"kind":"rule","rule_id":"…"}}'})
          <textarea name="fallback_config" defaultValue={JSON.stringify(inst.fallback_config, null, 2)} />
        </label>
        <label>Status
          <select name="status" defaultValue={inst.status}>
            <option value="draft">draft</option><option value="live">live</option>
            <option value="paused">paused</option><option value="archived">archived</option>
          </select>
        </label>
        <p className="muted" style={{ margin: 0 }}>
          &quot;live&quot; afvises automatisk (og sættes til draft), hvis instansen ingen mappings og intet
          eksplicit default-sæt har, hvis feedet ikke er healthy, eller hvis feedet stadig er demo-feedet.
          Tjek opsætningen i <a href="/stepcommerce/preview">Preview</a> først.
        </p>
        <button>Gem</button>
      </form>
    </>
  );
}
