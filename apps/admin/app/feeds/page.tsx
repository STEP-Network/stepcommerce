import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { query, sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Feeds() {
  async function create(formData: FormData) {
    'use server';
    const advertiserId = String(formData.get('advertiser_id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const url = String(formData.get('source_url') ?? '').trim();
    const type = String(formData.get('type') ?? 'google_shopping_xml');
    if (!advertiserId || !name || !url) return;
    await sql`insert into feed (advertiser_id, name, source_url, type) values (${advertiserId}, ${name}, ${url}, ${type})`;
    revalidatePath('/feeds');
  }

  const feeds = await query<{
    id: string; name: string; advertiser: string; type: string; status: string;
    last_fetch_at: string | null; products: string; source_url: string;
  }>(
    `select f.id, f.name, a.name as advertiser, f.type, f.status,
            to_char(f.last_fetch_at, 'YYYY-MM-DD HH24:MI') as last_fetch_at,
            (select count(*) from product p where p.feed_id = f.id and p.available)::text as products,
            f.source_url
     from feed f join advertiser a on a.id = f.advertiser_id
     order by f.created_at desc`,
  );
  const advertisers = await query<{ id: string; name: string }>('select id, name from advertiser order by name');

  return (
    <>
      <h1>Feeds</h1>
      <table>
        <thead><tr><th>Navn</th><th>Advertiser</th><th>Type</th><th>Health</th><th>Sidste fetch</th><th>Produkter</th></tr></thead>
        <tbody>
          {feeds.map((f) => (
            <tr key={f.id}>
              <td><Link href={`/feeds/${f.id}`}>{f.name}</Link></td>
              <td>{f.advertiser}</td>
              <td><code>{f.type}</code></td>
              <td><span className={`status ${f.status}`}>{f.status}</span></td>
              <td>{f.last_fetch_at ?? 'aldrig'}</td>
              <td>{f.products}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Opret feed</h2>
      <form className="panel" action={create}>
        <label>Advertiser
          <select name="advertiser_id" required>
            {advertisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label>Navn<input name="name" required /></label>
        <label>Feed-URL<input name="source_url" type="url" required placeholder="https://.../google-shopping.xml" /></label>
        <label>Type
          <select name="type">
            <option value="google_shopping_xml">Google Shopping XML</option>
            <option value="generic_xml">Generisk XML (kræver field mapping)</option>
            <option value="csv">CSV</option>
          </select>
        </label>
        <button>Opret</button>
      </form>
    </>
  );
}
