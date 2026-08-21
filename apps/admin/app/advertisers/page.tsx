// Advertiser list. An advertiser is the top-level owner of feeds and products,
// so this is the entry point for everything an advertiser brings to a widget.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirectWithBasePath } from '@/lib/base-path';
import { query } from '@/lib/db';
import { assetUrl, storeUpload } from '@/lib/assets';

export const dynamic = 'force-dynamic';

export default async function Advertisers({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  async function create(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return;
    let logoId: string | null = null;
    try {
      logoId = await storeUpload(formData.get('logo'));
    } catch (e) {
      await redirectWithBasePath(`/advertisers?error=${encodeURIComponent(e instanceof Error ? e.message : 'Upload fejlede')}`);
    }
    const rows = await query<{ id: string }>(
      `insert into advertiser (name, website, contact_name, contact_email, contact_phone, logo_asset_id)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        name,
        String(formData.get('website') ?? '').trim() || null,
        String(formData.get('contact_name') ?? '').trim() || null,
        String(formData.get('contact_email') ?? '').trim() || null,
        String(formData.get('contact_phone') ?? '').trim() || null,
        logoId,
      ],
    );
    revalidatePath('/advertisers');
    if (rows[0]) await redirectWithBasePath(`/advertisers/${rows[0].id}`);
  }

  const rows = await query<{
    id: string; name: string; status: string; logo_asset_id: string | null;
    contact_name: string | null; contact_email: string | null; contact_phone: string | null;
    feeds: string; products: string; widgets: string;
  }>(
    `select a.id, a.name, a.status, a.logo_asset_id, a.contact_name, a.contact_email, a.contact_phone,
            (select count(*) from feed f where f.advertiser_id = a.id)::text as feeds,
            (select count(*) from product p join feed f on f.id = p.feed_id
              where f.advertiser_id = a.id and p.available)::text as products,
            (select count(distinct ia.instance_id) from instance_advertiser ia where ia.advertiser_id = a.id)::text as widgets
     from advertiser a order by a.name`,
  );

  return (
    <>
      <h1>Annoncører</h1>
      <p className="muted">Feeds, produkter og priser hænger under annoncøren. Klik ind for at hente feed, browse produkter eller oprette produkter manuelt.</p>
      {error && <p className="bad">{error}</p>}

      <table>
        <thead><tr><th>Logo</th><th>Navn</th><th>Kontakt</th><th>Feeds</th><th>Produkter</th><th>Widgets</th><th>Status</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="muted">Ingen annoncører endnu.</td></tr>}
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.logo_asset_id ? <img className="logo" src={assetUrl(r.logo_asset_id)} alt="" /> : <span className="muted">—</span>}</td>
              <td><Link href={`/advertisers/${r.id}`}><b>{r.name}</b></Link></td>
              <td>
                {r.contact_name ?? <span className="muted">—</span>}
                {r.contact_email && <div className="muted">{r.contact_email}</div>}
                {r.contact_phone && <div className="muted">{r.contact_phone}</div>}
              </td>
              <td>{r.feeds}</td>
              <td>{r.products}</td>
              <td>{r.widgets}</td>
              <td><span className={`status ${r.status}`}>{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Opret annoncør</h2>
      <form className="panel" action={create}>
        <label>Navn<input name="name" required placeholder="Coop Danmark" /></label>
        <label>Website<input name="website" type="url" placeholder="https://coop.dk" /></label>
        <label>Logo (PNG, SVG, JPEG — max 512 KB)<input name="logo" type="file" accept="image/*" /></label>
        <div className="row">
          <label>Kontaktperson<input name="contact_name" placeholder="Navn" /></label>
          <label>E-mail<input name="contact_email" type="email" /></label>
          <label>Telefon<input name="contact_phone" /></label>
        </div>
        <button>Opret annoncør</button>
      </form>
    </>
  );
}
