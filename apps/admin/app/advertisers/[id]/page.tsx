// Advertiser hub: everything one advertiser brings to a widget — feeds, the
// product catalogue those feeds produce, hand-created affiliate products, and
// the contact/branding details the widget renders.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { redirectWithBasePath } from '@/lib/base-path';
import { query } from '@/lib/db';
import { assetUrl, storeUpload } from '@/lib/assets';
import { basePathUrl } from '@/lib/base-path';
import { fetchFeed, type FeedRow } from '@/lib/feed';
import ProductBrowser, { type BrowserParams } from '@/app/_components/product-browser';

export const dynamic = 'force-dynamic';

const TABS = [
  ['feeds', 'Feeds'],
  ['products', 'Produkter'],
  ['manual', 'Manuelle produkter'],
  ['settings', 'Indstillinger'],
] as const;

/** Manual products need a feed row to hang on; one per advertiser, never fetched. */
async function manualFeedId(advertiserId: string): Promise<string> {
  const existing = await query<{ id: string }>(
    `select id from feed where advertiser_id = $1 and type = 'manual' order by created_at limit 1`,
    [advertiserId],
  );
  if (existing[0]) return existing[0].id;
  const created = await query<{ id: string }>(
    `insert into feed (advertiser_id, name, source_url, type, status)
     values ($1, 'Manuelle produkter', 'manual://none', 'manual', 'healthy') returning id`,
    [advertiserId],
  );
  return created[0].id;
}

export default async function AdvertiserDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<BrowserParams & { tab?: string; error?: string; ok?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : 'feeds';

  async function saveSettings(formData: FormData) {
    'use server';
    let logoId: string | null = null;
    try {
      logoId = await storeUpload(formData.get('logo'));
    } catch (e) {
      await redirectWithBasePath(`/advertisers/${id}?tab=settings&error=${encodeURIComponent(e instanceof Error ? e.message : 'Upload fejlede')}`);
    }
    await query(
      `update advertiser set name = coalesce(nullif($2, ''), name), website = nullif($3, ''),
              contact_name = nullif($4, ''), contact_email = nullif($5, ''), contact_phone = nullif($6, ''),
              billing_contact = nullif($7, ''), status = $8,
              logo_asset_id = coalesce($9, logo_asset_id), updated_at = now()
       where id = $1`,
      [
        id,
        String(formData.get('name') ?? '').trim(),
        String(formData.get('website') ?? '').trim(),
        String(formData.get('contact_name') ?? '').trim(),
        String(formData.get('contact_email') ?? '').trim(),
        String(formData.get('contact_phone') ?? '').trim(),
        String(formData.get('billing_contact') ?? '').trim(),
        ['active', 'paused', 'archived'].includes(String(formData.get('status'))) ? String(formData.get('status')) : 'active',
        logoId,
      ],
    );
    revalidatePath(`/advertisers/${id}`);
  }

  async function createFeed(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    const url = String(formData.get('source_url') ?? '').trim();
    const type = String(formData.get('type') ?? 'google_shopping_xml');
    if (!name || !url) return;
    const rows = await query<{ id: string }>(
      `insert into feed (advertiser_id, name, source_url, type, item_element)
       values ($1, $2, $3, $4, nullif($5, '')) returning id`,
      [id, name, url, type, String(formData.get('item_element') ?? '').trim()],
    );
    // Fetch immediately: an empty feed is the single most confusing state in the
    // whole admin, and waiting for the hourly cron to explain it is not a UI.
    if (rows[0]) {
      const feedRows = await query<FeedRow>(
        'select id, source_url, type, field_mapping, last_fetch_hash, max_age_hours, item_element from feed where id = $1',
        [rows[0].id],
      );
      if (feedRows[0]) {
        try {
          await fetchFeed(feedRows[0]);
        } catch {
          // The feed page shows the error log; creation itself succeeded.
        }
      }
    }
    revalidatePath(`/advertisers/${id}`);
  }

  async function fetchNow(formData: FormData) {
    'use server';
    const feedId = String(formData.get('feed_id') ?? '');
    const rows = await query<FeedRow>(
      `select f.id, f.source_url, f.type, f.field_mapping, f.last_fetch_hash, f.max_age_hours, f.item_element
       from feed f where f.id = $1 and f.advertiser_id = $2`,
      [feedId, id],
    );
    if (rows[0]) await fetchFeed(rows[0]);
    revalidatePath(`/advertisers/${id}`);
  }

  async function createManual(formData: FormData) {
    'use server';
    const title = String(formData.get('title') ?? '').trim();
    const link = String(formData.get('link') ?? '').trim();
    if (!title || !link) return;
    const feedId = await manualFeedId(id);
    const price = String(formData.get('price') ?? '').replace(',', '.').trim();
    await query(
      `insert into product (feed_id, external_id, title, description, link, affiliate_url, image_link,
                            price_amount, price_currency, availability, brand, product_type, manual, sort_order)
       values ($1, $2, $3, nullif($4, ''), $5, nullif($6, ''), nullif($7, ''),
               nullif($8, '')::numeric, 'DKK', 'in stock', nullif($9, ''), nullif($10, ''), true,
               (select coalesce(max(sort_order), 0) + 1 from product where feed_id = $1))`,
      [
        feedId,
        `manual-${Date.now().toString(36)}`,
        title,
        String(formData.get('description') ?? '').trim(),
        link,
        String(formData.get('affiliate_url') ?? '').trim(),
        String(formData.get('image_link') ?? '').trim(),
        /^\d+(\.\d+)?$/.test(price) ? price : '',
        String(formData.get('brand') ?? '').trim(),
        String(formData.get('product_type') ?? '').trim(),
      ],
    );
    revalidatePath(`/advertisers/${id}`);
  }

  async function deleteManual(formData: FormData) {
    'use server';
    await query(
      `delete from product p using feed f
       where p.id = $1 and f.id = p.feed_id and f.advertiser_id = $2 and p.manual`,
      [String(formData.get('pid') ?? ''), id],
    );
    revalidatePath(`/advertisers/${id}`);
  }

  const advertisers = await query<{
    id: string; name: string; status: string; website: string | null; logo_asset_id: string | null;
    contact_name: string | null; contact_email: string | null; contact_phone: string | null; billing_contact: string | null;
  }>(
    `select id, name, status, website, logo_asset_id, contact_name, contact_email, contact_phone, billing_contact
     from advertiser where id = $1`,
    [id],
  );
  const adv = advertisers[0];
  if (!adv) return <h1>Annoncør ikke fundet</h1>;

  const feeds = await query<{
    id: string; name: string; type: string; status: string; source_url: string;
    last_fetch_at: string | null; products: string; rules: string; changed: string | null;
  }>(
    `select f.id, f.name, f.type, f.status, f.source_url,
            to_char(f.last_fetch_at, 'YYYY-MM-DD HH24:MI') as last_fetch_at,
            to_char(f.content_changed_at, 'YYYY-MM-DD HH24:MI') as changed,
            (select count(*) from product p where p.feed_id = f.id and p.available)::text as products,
            (select count(*) from product_rule r where r.feed_id = f.id)::text as rules
     from feed f where f.advertiser_id = $1 order by f.type = 'manual', f.created_at`,
    [id],
  );
  const feedIds = feeds.map((f) => f.id);

  const urlBase = `/advertisers/${id}`;
  const manualProducts = tab === 'manual'
    ? await query<{ id: string; title: string; link: string; affiliate_url: string | null; image_link: string | null; price: string | null; brand: string | null }>(
        `select p.id, p.title, p.link, p.affiliate_url, p.image_link, p.price_amount::text as price, p.brand
         from product p join feed f on f.id = p.feed_id
         where f.advertiser_id = $1 and p.manual order by p.sort_order nulls last, p.created_at`,
        [id],
      )
    : [];

  return (
    <>
      <h1>
        {adv.logo_asset_id && <img className="logo" src={assetUrl(adv.logo_asset_id)} alt="" style={{ marginRight: 10 }} />}
        {adv.name} <span className={`status ${adv.status}`}>{adv.status}</span>
      </h1>
      <p className="muted">
        <Link href="/advertisers">← Alle annoncører</Link>
        {adv.website && <> · <a href={adv.website} target="_blank" rel="noreferrer">{adv.website.replace(/^https?:\/\//, '')}</a></>}
        {adv.contact_name && <> · {adv.contact_name}</>}
        {adv.contact_email && <> · {adv.contact_email}</>}
        {adv.contact_phone && <> · {adv.contact_phone}</>}
      </p>

      <div className="tabs">
        {TABS.map(([t, label]) => (
          <a key={t} className={tab === t ? 'on' : ''} href={basePathUrl(`${urlBase}?tab=${t}`)}>{label}</a>
        ))}
      </div>
      {sp.error && <p className="bad">{sp.error}</p>}

      {tab === 'feeds' && (
        <>
          <table>
            <thead><tr><th>Feed</th><th>Type</th><th>Health</th><th>Sidste fetch</th><th>Indhold ændret</th><th>Produkter</th><th>Regler</th><th></th></tr></thead>
            <tbody>
              {feeds.length === 0 && <tr><td colSpan={8} className="muted">Ingen feeds — opret et nedenfor.</td></tr>}
              {feeds.map((f) => (
                <tr key={f.id}>
                  <td><Link href={`/feeds/${f.id}`}>{f.name}</Link>
                      <div className="muted" style={{ wordBreak: 'break-all' }}>{f.source_url}</div></td>
                  <td><code>{f.type}</code></td>
                  <td><span className={`status ${f.status}`}>{f.status}</span></td>
                  <td>{f.type === 'manual' ? '—' : f.last_fetch_at ?? 'aldrig'}</td>
                  <td>{f.type === 'manual' ? '—' : f.changed ?? 'aldrig'}</td>
                  <td>{f.products}</td>
                  <td>{f.rules}</td>
                  <td>
                    {f.type !== 'manual' && (
                      <form action={fetchNow}>
                        <input type="hidden" name="feed_id" value={f.id} />
                        <button className="small ghost">Hent nu</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Tilføj feed</h2>
          <form className="panel" action={createFeed}>
            <label>Navn<input name="name" required placeholder="Intersport produktfeed" /></label>
            <label>Feed-URL<input name="source_url" type="url" required placeholder="https://files.channable.com/….xml" /></label>
            <div className="row">
              <label>Format
                <select name="type">
                  <option value="google_shopping_xml">Google Shopping XML</option>
                  <option value="generic_xml">Generisk XML</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
              <label>Produkt-element (kun generisk XML)<input name="item_element" placeholder="product" /></label>
            </div>
            <p className="muted" style={{ margin: 0 }}>Feedet hentes med det samme, så du kan se produkterne i næste faneblad.</p>
            <button>Tilføj og hent feed</button>
          </form>
        </>
      )}

      {tab === 'products' && (
        <ProductBrowser feedIds={feedIds} urlBase={`${urlBase}`} params={{ ...sp, tab: 'products' } as BrowserParams} feeds={feeds} />
      )}

      {tab === 'manual' && (
        <>
          <p className="hint">
            Manuelle produkter er til udvalgte varer uden feed — typisk affiliate-links. De er undtaget
            fra feed-friskhedskravet, fordi der ikke er nogen kilde at hente dem fra: pris og lager er
            dit ansvar. Sæt affiliate-URL&apos;en her, så bruger klik-redirect den frem for det rene link.
          </p>
          <table>
            <thead><tr><th></th><th>Titel</th><th>Pris</th><th>Destination</th><th></th></tr></thead>
            <tbody>
              {manualProducts.length === 0 && <tr><td colSpan={5} className="muted">Ingen manuelle produkter.</td></tr>}
              {manualProducts.map((p) => (
                <tr key={p.id}>
                  <td><span className="thumb-sm" style={p.image_link ? { backgroundImage: `url(${JSON.stringify(p.image_link)})` } : undefined} /></td>
                  <td>{p.title}<div className="muted">{p.brand ?? ''}</div></td>
                  <td>{p.price ?? '—'}</td>
                  <td style={{ wordBreak: 'break-all' }}><a href={p.affiliate_url ?? p.link} target="_blank" rel="noreferrer">{p.affiliate_url ?? p.link}</a></td>
                  <td>
                    <form action={deleteManual}>
                      <input type="hidden" name="pid" value={p.id} />
                      <button className="small danger">Slet</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Opret produkt manuelt</h2>
          <form className="panel" action={createManual}>
            <label>Titel<input name="title" required placeholder="Amarone della Valpolicella 2019" /></label>
            <div className="row">
              <label>Pris (DKK)<input name="price" placeholder="249" /></label>
              <label>Brand<input name="brand" placeholder="Zenato" /></label>
              <label>Kategori<input name="product_type" placeholder="Vin &gt; Rødvin" /></label>
            </div>
            <label>Produkt-URL (landingsside)<input name="link" type="url" required placeholder="https://…" /></label>
            <label>Affiliate-URL (bruges som klik-destination hvis udfyldt)<input name="affiliate_url" type="url" placeholder="https://track.adtraction.com/t/t?a=…" /></label>
            <label>Billed-URL<input name="image_link" type="url" /></label>
            <label>Beskrivelse<textarea name="description" style={{ minHeight: 60 }} /></label>
            <button>Opret produkt</button>
          </form>
        </>
      )}

      {tab === 'settings' && (
        <form className="panel" action={saveSettings}>
          <label>Navn<input name="name" defaultValue={adv.name} required /></label>
          <label>Website<input name="website" type="url" defaultValue={adv.website ?? ''} /></label>
          <label>
            Logo {adv.logo_asset_id && <img className="logo" src={assetUrl(adv.logo_asset_id)} alt="" />}
            <input name="logo" type="file" accept="image/*" />
          </label>
          <div className="row">
            <label>Kontaktperson<input name="contact_name" defaultValue={adv.contact_name ?? ''} /></label>
            <label>E-mail<input name="contact_email" type="email" defaultValue={adv.contact_email ?? ''} /></label>
            <label>Telefon<input name="contact_phone" defaultValue={adv.contact_phone ?? ''} /></label>
          </div>
          <label>Faktureringskontakt<input name="billing_contact" defaultValue={adv.billing_contact ?? ''} /></label>
          <label>Status
            <select name="status" defaultValue={adv.status}>
              <option value="active">active</option><option value="paused">paused</option><option value="archived">archived</option>
            </select>
          </label>
          <button>Gem</button>
        </form>
      )}
    </>
  );
}
