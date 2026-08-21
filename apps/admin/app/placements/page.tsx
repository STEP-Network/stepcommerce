// Placements (Level A): ordered KV → widget rules + embed/GAM snippet generator (spec §11).
import { revalidatePath } from 'next/cache';
import { query, sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

function widgetOrigin(): string {
  // Includes the base path — snippets must point at .../stepcommerce/w.js etc.
  return process.env.WIDGET_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? 'https://stepnetwork.dk/stepcommerce';
}

function embedSnippet(code: string): string {
  return `<script async src="${widgetOrigin()}/w.js"\n        data-placement="${code}"></script>`;
}

function gamSnippet(code: string, kvKeys: string[]): string {
  const kv = kvKeys.map((k) => `      "${k}": "%%PATTERN:${k}%%"`).join(',\n');
  return `<script src="${widgetOrigin()}/w.js"></script>\n<script>\n  window.STEPCommerce && window.STEPCommerce.init({\n    placement: "${code}",\n    serveUrl: "${widgetOrigin()}/api/serve",\n    clickMacro: "%%CLICK_URL_UNESC%%",\n    kv: {\n${kv}\n    }\n  });\n</script>`;
}

interface PlacementRow {
  id: string;
  name: string;
  code: string;
  site: string;
  status: string;
  rules: { match?: { key?: string }; instance_id?: string }[];
  default_instance: string | null;
  /** Level-B keys of every instance this placement can serve. */
  mapping_keys: string[];
  instance_names: string[];
}

export default async function Placements() {
  async function create(formData: FormData) {
    'use server';
    const siteId = String(formData.get('site_id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const code = String(formData.get('code') ?? '').trim();
    const defaultInstance = String(formData.get('default_instance_id') ?? '') || null;
    if (!siteId || !name || !/^PLC_[A-Za-z0-9_-]+$/.test(code)) return;
    await sql`
      insert into placement (site_id, name, code, rules, default_instance_id)
      values (${siteId}, ${name}, ${code}, '[]'::jsonb, ${defaultInstance})`;
    revalidatePath('/placements');
  }

  // Rule builder: appends one rule from a form instead of hand-written JSON, so
  // nobody has to copy an instance UUID out of the address bar.
  async function addRule(formData: FormData) {
    'use server';
    const pid = String(formData.get('id') ?? '');
    const key = String(formData.get('key') ?? '').trim();
    const operator = String(formData.get('operator') ?? 'eq');
    const value = String(formData.get('value') ?? '').trim();
    const instanceId = String(formData.get('instance_id') ?? '');
    if (!pid || !key || !instanceId || !['eq', 'contains'].includes(operator)) return;
    await sql`
      update placement
      set rules = coalesce(rules, '[]'::jsonb) || ${JSON.stringify([
        { match: { key, operator, value }, instance_id: instanceId },
      ])}::jsonb,
      updated_at = now()
      where id = ${pid}`;
    revalidatePath('/placements');
  }

  async function removeRule(formData: FormData) {
    'use server';
    const pid = String(formData.get('id') ?? '');
    const idx = Number(formData.get('idx'));
    if (!pid || !Number.isInteger(idx)) return;
    await sql`update placement set rules = rules - ${idx}, updated_at = now() where id = ${pid}`;
    revalidatePath('/placements');
  }

  async function setStatus(formData: FormData) {
    'use server';
    const pid = String(formData.get('id') ?? '');
    const status = String(formData.get('status') ?? '');
    if (!['live', 'paused', 'archived'].includes(status)) return;
    await sql`update placement set status = ${status}, updated_at = now() where id = ${pid}`;
    revalidatePath('/placements');
  }

  const placements = await query<PlacementRow>(
    `with reachable as (
       select p.id as placement_id,
              coalesce((r->>'instance_id')::uuid, p.default_instance_id) as instance_id
       from placement p
       left join lateral jsonb_array_elements(coalesce(p.rules, '[]'::jsonb)) r on true
       union
       select p.id, p.default_instance_id from placement p where p.default_instance_id is not null
     )
     select p.id, p.name, p.code, s.domain as site, p.status, p.rules,
            wi.name as default_instance,
            coalesce((select array_agg(distinct m.page_key)
                      from reachable rc
                      join kv_mapping m on m.instance_id = rc.instance_id
                      where rc.placement_id = p.id), '{}') as mapping_keys,
            coalesce((select array_agg(distinct w2.name)
                      from reachable rc join widget_instance w2 on w2.id = rc.instance_id
                      where rc.placement_id = p.id), '{}') as instance_names
     from placement p
     join site s on s.id = p.site_id
     left join widget_instance wi on wi.id = p.default_instance_id
     order by p.created_at desc`,
  );
  const [sites, instances] = await Promise.all([
    query<{ id: string; domain: string }>('select id, domain from site order by domain'),
    query<{ id: string; name: string; domain: string; status: string }>(
      `select wi.id, wi.name, s.domain, wi.status
       from widget_instance wi join site s on s.id = wi.site_id
       where wi.status <> 'archived' order by s.domain, wi.name`,
    ),
  ]);

  return (
    <>
      <h1>Placements</h1>
      <p className="muted">
        Embed-tagget refererer et placement, aldrig en instans. Regler evalueres i rækkefølge mod sidens
        key-values og vælger widget-instansen (Level A). Uden match: default-instans, ellers renderes intet.
      </p>
      {placements.map((p) => {
        const ruleKeys = (p.rules ?? []).map((r) => r.match?.key).filter(Boolean) as string[];
        // The GAM creative can only send keys we name in the macro list. It must
        // therefore include BOTH the placement's rule keys (Level A) and every
        // mapping key of the instances behind it (Level B) — otherwise the
        // creative resolves an instance and then matches no products at all.
        const kvKeys = [...new Set([...ruleKeys, ...(p.mapping_keys ?? []), 'limited_ads'])];
        const missing = (p.mapping_keys ?? []).filter((k) => !kvKeys.includes(k));
        return (
          <div key={p.id}>
            <h2>
              {p.name} · <code>{p.code}</code> · {p.site} ·{' '}
              <span className={`status ${p.status}`}>{p.status}</span>
            </h2>
            <p className="muted">
              Default-instans: {p.default_instance ?? 'ingen (render intet)'} ·
              {' '}instanser bag: {(p.instance_names ?? []).join(', ') || '—'} ·
              {' '}Level-B-nøgler: {(p.mapping_keys ?? []).join(', ') || 'ingen'}
            </p>

            <table>
              <thead><tr><th>#</th><th>Hvis key-value</th><th>→ instans</th><th></th></tr></thead>
              <tbody>
                {(p.rules ?? []).length === 0 && (
                  <tr><td colSpan={4} className="muted">Ingen regler — default-instansen bruges.</td></tr>
                )}
                {(p.rules ?? []).map((r, i) => (
                  <tr key={i}>
                    <td>{i}</td>
                    <td><code>{r.match?.key}</code> {(r.match as { operator?: string })?.operator} <code>{(r.match as { value?: string })?.value}</code></td>
                    <td>{instances.find((x) => x.id === r.instance_id)?.name ?? <code>{r.instance_id}</code>}</td>
                    <td>
                      <form action={removeRule}>
                        <input type="hidden" name="id" value={p.id} />
                        <input type="hidden" name="idx" value={i} />
                        <button className="small">Slet</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h2>Tilføj regel</h2>
            <form className="panel" action={addRule}>
              <input type="hidden" name="id" value={p.id} />
              <label>Page-key<input name="key" required placeholder="mv_page" /></label>
              <label>Operator
                <select name="operator"><option value="eq">er lig med</option><option value="contains">indeholder</option></select>
              </label>
              <label>Værdi<input name="value" required placeholder="artikel" /></label>
              <label>Serverér instans
                <select name="instance_id" required>
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>{i.domain} — {i.name} ({i.status})</option>
                  ))}
                </select>
              </label>
              <button className="small">Tilføj regel</button>
            </form>

            <form className="panel" action={setStatus} style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={p.id} />
              <label>Status
                <select name="status" defaultValue={p.status}>
                  <option value="live">live</option><option value="paused">paused</option><option value="archived">archived</option>
                </select>
              </label>
              <button className="small">Gem status</button>
            </form>

            {missing.length > 0 && (
              <p style={{ color: '#a02222', fontWeight: 600 }}>
                Advarsel: mapping-nøglerne {missing.join(', ')} mangler i GAM-snippet.
              </p>
            )}
            <h2>Embed (direkte script-tag)</h2>
            <pre><code>{embedSnippet(p.code)}</code></pre>
            <h2>GAM HTML5-kreativ (KVs via %%PATTERN%% — læs aldrig googletag fra SafeFrame)</h2>
            <pre><code>{gamSnippet(p.code, kvKeys)}</code></pre>
          </div>
        );
      })}

      <h2>Opret placement</h2>
      <form className="panel" action={create}>
        <label>Site<select name="site_id">{sites.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}</select></label>
        <label>Navn<input name="name" required /></label>
        <label>Kode<input name="code" required placeholder="PLC_mv_recipe" pattern="PLC_[A-Za-z0-9_-]+" /></label>
        <label>Default-instans
          <select name="default_instance_id">
            <option value="">ingen (render intet)</option>
            {instances.map((i) => <option key={i.id} value={i.id}>{i.domain} — {i.name}</option>)}
          </select>
        </label>
        <button>Opret</button>
      </form>
    </>
  );
}
