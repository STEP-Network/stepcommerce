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

export default async function Placements() {
  async function create(formData: FormData) {
    'use server';
    const siteId = String(formData.get('site_id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const code = String(formData.get('code') ?? '').trim();
    const rules = JSON.parse(String(formData.get('rules') ?? '[]'));
    const defaultInstance = String(formData.get('default_instance_id') ?? '') || null;
    if (!siteId || !name || !/^PLC_[A-Za-z0-9_-]+$/.test(code)) return;
    await sql`
      insert into placement (site_id, name, code, rules, default_instance_id)
      values (${siteId}, ${name}, ${code}, ${JSON.stringify(rules)}, ${defaultInstance})`;
    revalidatePath('/placements');
  }

  async function updateRules(formData: FormData) {
    'use server';
    const pid = String(formData.get('id') ?? '');
    const rules = JSON.parse(String(formData.get('rules') ?? '[]'));
    await sql`update placement set rules = ${JSON.stringify(rules)}, updated_at = now() where id = ${pid}`;
    revalidatePath('/placements');
  }

  const placements = await query<{
    id: string; name: string; code: string; site: string; status: string;
    rules: { match: { key: string } }[]; default_instance: string | null;
  }>(
    `select p.id, p.name, p.code, s.domain as site, p.status, p.rules,
            wi.name as default_instance
     from placement p
     join site s on s.id = p.site_id
     left join widget_instance wi on wi.id = p.default_instance_id
     order by p.created_at desc`,
  );
  const [sites, instances] = await Promise.all([
    query<{ id: string; domain: string }>('select id, domain from site order by domain'),
    query<{ id: string; name: string }>('select id, name from widget_instance order by name'),
  ]);

  return (
    <>
      <h1>Placements</h1>
      <p className="muted">
        Embed-tagget refererer et placement, aldrig en instans. Regler evalueres i rækkefølge mod sidens
        key-values og vælger widget-instansen (Level A). Uden match: default-instans, ellers renderes intet.
      </p>
      {placements.map((p) => {
        const kvKeys = [...new Set((p.rules ?? []).map((r) => r.match?.key).filter(Boolean))];
        if (!kvKeys.length) kvKeys.push('mv_cat', 'mv_ingredients');
        kvKeys.push('limited_ads');
        return (
          <div key={p.id}>
            <h2>{p.name} · <code>{p.code}</code> · {p.site} · <span className={`status ${p.status}`}>{p.status}</span></h2>
            <p className="muted">Default-instans: {p.default_instance ?? 'ingen (render intet)'}</p>
            <form className="panel" action={updateRules}>
              <input type="hidden" name="id" value={p.id} />
              <label>Regler (ordnet JSON-liste)
                <textarea name="rules" defaultValue={JSON.stringify(p.rules, null, 2)} />
              </label>
              <button className="small">Gem regler</button>
            </form>
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
        <label>Regler (JSON)
          <textarea name="rules" defaultValue={'[\n  { "match": { "key": "mv_page", "operator": "eq", "value": "artikel" }, "instance_id": "<instans-uuid>" }\n]'} />
        </label>
        <label>Default-instans<select name="default_instance_id"><option value="">ingen (render intet)</option>{instances.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        <button>Opret</button>
      </form>
    </>
  );
}
