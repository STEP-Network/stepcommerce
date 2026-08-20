import { revalidatePath } from 'next/cache';
import { query, sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Sites() {
  async function createSite(formData: FormData) {
    'use server';
    const publisher = String(formData.get('publisher') ?? '').trim();
    const domain = String(formData.get('domain') ?? '').trim();
    if (!publisher || !domain) return;
    await sql`insert into site (publisher, domain) values (${publisher}, ${domain})`;
    revalidatePath('/sites');
  }

  async function createDict(formData: FormData) {
    'use server';
    const siteId = String(formData.get('site_id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const bulk = String(formData.get('entries') ?? '');
    if (!siteId || !name) return;
    // Bulk paste: one "term<TAB or ;>segment" pair per line (spec §14: per-site
    // ingredient/term dictionary is a first-class mapping asset).
    const entries: Record<string, string> = {};
    for (const line of bulk.split('\n')) {
      const [term, segment] = line.split(/[\t;]/).map((s) => s?.trim());
      if (term && segment) entries[term.toLowerCase()] = segment;
    }
    await sql`insert into kv_dictionary (site_id, name, entries) values (${siteId}, ${name}, ${JSON.stringify(entries)})`;
    revalidatePath('/sites');
  }

  const sites = await query<{ id: string; publisher: string; domain: string }>('select id, publisher, domain from site order by publisher');
  const dicts = await query<{ id: string; name: string; domain: string; n: string }>(
    `select d.id, d.name, s.domain, (select count(*) from jsonb_object_keys(d.entries))::text as n
     from kv_dictionary d join site s on s.id = d.site_id order by s.domain`,
  );

  return (
    <>
      <h1>Sites</h1>
      <table>
        <thead><tr><th>Publisher</th><th>Domæne</th><th>ID</th></tr></thead>
        <tbody>{sites.map((s) => <tr key={s.id}><td>{s.publisher}</td><td>{s.domain}</td><td><code>{s.id}</code></td></tr>)}</tbody>
      </table>

      <h2>Opret site</h2>
      <form className="panel" action={createSite}>
        <label>Publisher<input name="publisher" required /></label>
        <label>Domæne<input name="domain" required placeholder="madensverden.dk" /></label>
        <button>Opret</button>
      </form>

      <h2>Ordbøger (KV dictionary — dict-match på multi-value keys)</h2>
      <table>
        <thead><tr><th>Navn</th><th>Site</th><th>Termer</th><th>ID</th></tr></thead>
        <tbody>{dicts.map((d) => <tr key={d.id}><td>{d.name}</td><td>{d.domain}</td><td>{d.n}</td><td><code>{d.id}</code></td></tr>)}</tbody>
      </table>

      <h2>Opret ordbog (bulk paste)</h2>
      <form className="panel" action={createDict}>
        <label>Site
          <select name="site_id">{sites.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}</select>
        </label>
        <label>Navn<input name="name" required placeholder="Ingredienser → pairing-segment" /></label>
        <label>Term → segment (én pr. linje, adskilt med tab eller semikolon)
          <textarea name="entries" placeholder={'skinkeschnitzler;svinekød\nskinke;svinekød\nkylling;fjerkræ'} />
        </label>
        <button>Opret</button>
      </form>
    </>
  );
}
