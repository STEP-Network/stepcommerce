import { revalidatePath } from 'next/cache';
import { query, sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Advertisers() {
  async function create(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return;
    await sql`insert into advertiser (name, billing_contact) values (${name}, ${String(formData.get('contact') ?? '') || null})`;
    revalidatePath('/advertisers');
  }

  const rows = await query<{ id: string; name: string; status: string; billing_contact: string | null; feeds: string }>(
    `select a.id, a.name, a.status, a.billing_contact,
            (select count(*) from feed f where f.advertiser_id = a.id)::text as feeds
     from advertiser a order by a.created_at desc`,
  );

  return (
    <>
      <h1>Advertisers</h1>
      <table>
        <thead><tr><th>Navn</th><th>Status</th><th>Kontakt</th><th>Feeds</th><th>ID</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td><span className={`status ${r.status}`}>{r.status}</span></td>
              <td>{r.billing_contact ?? '—'}</td>
              <td>{r.feeds}</td>
              <td><code>{r.id}</code></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Opret advertiser</h2>
      <form className="panel" action={create}>
        <label>Navn<input name="name" required /></label>
        <label>Billing-kontakt<input name="contact" /></label>
        <button>Opret</button>
      </form>
    </>
  );
}
