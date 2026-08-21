// Sites (publisher domains). A site owns the key-values its pages can send —
// the wizard reads that taxonomy so nobody has to remember whether the key is
// mv_cat or mv_category.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirectWithBasePath } from '@/lib/base-path';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface KvKey { key: string; label?: string; values?: string[]; multi?: boolean }

export default async function Sites() {
  async function createSite(formData: FormData) {
    'use server';
    const publisher = String(formData.get('publisher') ?? '').trim();
    const domain = String(formData.get('domain') ?? '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!publisher || !domain) return;
    const rows = await query<{ id: string }>(
      `insert into site (publisher, domain, contact) values ($1, $2, nullif($3, ''))
       on conflict (domain) do update set publisher = excluded.publisher returning id`,
      [publisher, domain, String(formData.get('contact') ?? '').trim()],
    );
    revalidatePath('/sites');
    if (rows[0]) await redirectWithBasePath(`/sites/${rows[0].id}`);
  }

  const sites = await query<{
    id: string; publisher: string; domain: string; kv_taxonomy: { keys?: KvKey[] } | null;
    dicts: string; placements: string; widgets: string;
  }>(
    `select s.id, s.publisher, s.domain, s.kv_taxonomy,
            (select count(*) from kv_dictionary d where d.site_id = s.id)::text as dicts,
            (select count(*) from placement p where p.site_id = s.id)::text as placements,
            (select count(*) from widget_instance w where w.site_id = s.id and w.status <> 'archived')::text as widgets
     from site s order by s.publisher, s.domain`,
  );

  return (
    <>
      <h1>Sites</h1>
      <p className="muted">Et site er et publisher-domæne plus de key-values sidens sideskabelon kan sende med. Widget-wizarden henter nøglerne herfra.</p>

      <table>
        <thead><tr><th>Domæne</th><th>Publisher</th><th>Keys</th><th>Ordbøger</th><th>Widgets</th><th>Placements</th></tr></thead>
        <tbody>
          {sites.length === 0 && <tr><td colSpan={6} className="muted">Ingen sites endnu.</td></tr>}
          {sites.map((s) => (
            <tr key={s.id}>
              <td><Link href={`/sites/${s.id}`}><b>{s.domain}</b></Link></td>
              <td>{s.publisher}</td>
              <td>
                {(s.kv_taxonomy?.keys ?? []).length === 0
                  ? <span className="muted">ingen — tilføj dem</span>
                  : <span className="chipset">{(s.kv_taxonomy!.keys ?? []).map((k) => <span className="chip" key={k.key}>{k.key}</span>)}</span>}
              </td>
              <td>{s.dicts}</td>
              <td>{s.widgets}</td>
              <td>{s.placements}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Opret site</h2>
      <form className="panel" action={createSite}>
        <label>Publisher<input name="publisher" required placeholder="Madens Verden" /></label>
        <label>Domæne<input name="domain" required placeholder="madensverden.dk" /></label>
        <label>Kontakt<input name="contact" placeholder="navn / e-mail" /></label>
        <button>Opret</button>
      </form>
    </>
  );
}
