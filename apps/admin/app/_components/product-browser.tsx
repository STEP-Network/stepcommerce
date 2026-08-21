// Shared product browser: search, category/brand filters, list + grid view with
// images. Used both per-feed and per-advertiser (across all their feeds), and
// by the wizard when hand-picking products.
import { query } from '@/lib/db';
import { basePathUrl } from '@/lib/base-path';

const PAGE_SIZE = 48;

export interface BrowserParams {
  q?: string;
  cat?: string;
  brand?: string;
  view?: string;
  feed?: string;
  page?: string;
  /** Only show products that are missing from the latest fetch too. */
  gone?: string;
}

interface Row {
  id: string;
  external_id: string;
  title: string;
  brand: string | null;
  image_link: string | null;
  link: string;
  price: string | null;
  sale_price: string | null;
  currency: string | null;
  availability: string | null;
  category: string | null;
  feed_name: string;
  manual: boolean;
  available: boolean;
}

/** Category label: product_type is the useful one in Danish feeds, then Google's taxonomy, then custom_label_0. */
const CATEGORY_SQL = "coalesce(nullif(p.product_type, ''), nullif(p.google_product_category, ''), nullif(p.custom_label_0, ''))";

// Plain anchors and GET forms bypass next/link, so the base path has to be
// added by hand — without it every filter click leaves /stepcommerce and 404s.
function qs(base: string, params: BrowserParams, patch: Partial<BrowserParams>): string {
  const merged = { ...params, ...patch } as Record<string, string | undefined>;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) if (v) sp.set(k, v);
  const s = sp.toString();
  return basePathUrl(s ? `${base}?${s}` : base);
}

export default async function ProductBrowser({
  feedIds,
  urlBase,
  params,
  feeds,
  /** Rendered inside each card/row, e.g. the wizard's "pick this product" button. */
  action,
}: {
  feedIds: string[];
  urlBase: string;
  params: BrowserParams;
  feeds?: { id: string; name: string }[];
  action?: (product: { id: string; title: string }) => React.ReactNode;
}) {
  if (feedIds.length === 0) {
    return <p className="muted">Ingen feeds endnu — opret et feed for at få produkter ind.</p>;
  }
  const scope = params.feed && feedIds.includes(params.feed) ? [params.feed] : feedIds;
  const grid = params.view !== 'list';
  const page = Math.max(0, Number(params.page ?? 0) || 0);

  const where: string[] = ['p.feed_id = any($1)'];
  const args: unknown[] = [scope];
  if (params.gone !== '1') where.push('p.available');
  if (params.q) {
    args.push(`%${params.q}%`);
    where.push(`(p.title ilike $${args.length} or p.brand ilike $${args.length} or p.external_id ilike $${args.length})`);
  }
  if (params.cat) {
    args.push(params.cat);
    where.push(`${CATEGORY_SQL} = $${args.length}`);
  }
  if (params.brand) {
    args.push(params.brand);
    where.push(`p.brand = $${args.length}`);
  }
  const whereSql = where.join(' and ');

  const [rows, counts, cats, brands] = await Promise.all([
    query<Row>(
      `select p.id, p.external_id, p.title, p.brand, p.image_link, coalesce(p.affiliate_url, p.link) as link,
              p.price_amount::text as price, p.sale_price_amount::text as sale_price, p.price_currency as currency,
              p.availability, ${CATEGORY_SQL} as category, f.name as feed_name, p.manual, p.available
       from product p join feed f on f.id = p.feed_id
       where ${whereSql}
       order by p.manual desc, p.sort_order nulls last, p.title
       limit ${PAGE_SIZE} offset ${page * PAGE_SIZE}`,
      args,
    ),
    query<{ n: string }>(`select count(*)::text as n from product p where ${whereSql}`, args),
    query<{ v: string; n: string }>(
      `select ${CATEGORY_SQL} as v, count(*)::text as n from product p
       where p.feed_id = any($1) and p.available and ${CATEGORY_SQL} is not null
       group by 1 order by count(*) desc limit 40`,
      [scope],
    ),
    query<{ v: string; n: string }>(
      `select p.brand as v, count(*)::text as n from product p
       where p.feed_id = any($1) and p.available and p.brand is not null
       group by 1 order by count(*) desc limit 25`,
      [scope],
    ),
  ]);
  const total = Number(counts[0]?.n ?? 0);

  return (
    <>
      <form className="card" style={{ display: 'grid', gap: 10, marginBottom: 14 }} action={basePathUrl(urlBase)} method="get">
        {params.view ? <input type="hidden" name="view" value={params.view} /> : null}
        <div className="row">
          <label style={{ flex: '2 1 260px' }}>
            Søg (titel, brand, produkt-ID)
            <input name="q" defaultValue={params.q ?? ''} placeholder="rødvin amarone" />
          </label>
          {feeds && feeds.length > 1 && (
            <label>
              Feed
              <select name="feed" defaultValue={params.feed ?? ''}>
                <option value="">Alle feeds</option>
                {feeds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
          )}
          {brands.length > 1 && (
            <label>
              Brand
              <select name="brand" defaultValue={params.brand ?? ''}>
                <option value="">Alle</option>
                {brands.map((b) => <option key={b.v} value={b.v}>{b.v} ({b.n})</option>)}
              </select>
            </label>
          )}
          <button className="small">Filtrér</button>
          <a className="chip" href={basePathUrl(urlBase)}>Nulstil</a>
        </div>
        {cats.length > 0 && (
          <div className="chipset">
            <span className="muted" style={{ alignSelf: 'center' }}>Kategori:</span>
            <a className={`chip ${params.cat ? '' : 'on'}`} href={qs(urlBase, params, { cat: undefined, page: undefined })}>Alle</a>
            {cats.map((c) => (
              <a key={c.v} className={`chip ${params.cat === c.v ? 'on' : ''}`}
                 href={qs(urlBase, params, { cat: c.v, page: undefined })}>{c.v} ({c.n})</a>
            ))}
          </div>
        )}
      </form>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="muted">
          {total} produkter{params.q || params.cat || params.brand ? ' matcher filteret' : ''}
          {total > PAGE_SIZE ? ` · viser ${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)}` : ''}
        </span>
        <span className="chipset">
          <a className={`chip ${grid ? 'on' : ''}`} href={qs(urlBase, params, { view: 'grid' })}>Gitter</a>
          <a className={`chip ${grid ? '' : 'on'}`} href={qs(urlBase, params, { view: 'list' })}>Liste</a>
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="muted">Ingen produkter matcher. Er feedet hentet?</p>
      ) : grid ? (
        <div className="pgrid">
          {rows.map((p) => (
            <div className="pcard" key={p.id}>
              <div className="thumb" style={p.image_link ? { backgroundImage: `url(${JSON.stringify(p.image_link)})` } : undefined} />
              <div className="body">
                <span className="t">{p.title}</span>
                <span className="p">
                  {p.sale_price ? <><s className="muted">{p.price}</s> {p.sale_price}</> : p.price ?? '—'} {p.currency ?? ''}
                </span>
                <span className="muted">
                  {p.brand ?? p.feed_name}{p.manual ? ' · manuel' : ''}
                  {p.available ? '' : ' · væk fra feed'}
                </span>
                {action?.(p)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <table>
          <thead>
            <tr><th></th><th>Titel</th><th>Kategori</th><th>Brand</th><th>Pris</th><th>Lager</th><th>Feed</th>{action ? <th></th> : null}</tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><span className="thumb-sm" style={p.image_link ? { backgroundImage: `url(${JSON.stringify(p.image_link)})` } : undefined} /></td>
                <td><a href={p.link} target="_blank" rel="noreferrer">{p.title}</a>
                    <div className="muted"><code>{p.external_id}</code>{p.manual ? ' · manuel' : ''}</div></td>
                <td>{p.category ?? '—'}</td>
                <td>{p.brand ?? '—'}</td>
                <td>{p.sale_price ?? p.price ?? '—'} {p.currency ?? ''}</td>
                <td>{p.availability ?? '—'}</td>
                <td>{p.feed_name}</td>
                {action ? <td>{action(p)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {total > PAGE_SIZE && (
        <div className="row" style={{ marginTop: 12 }}>
          {page > 0 && <a className="chip" href={qs(urlBase, params, { page: String(page - 1) })}>← Forrige</a>}
          {(page + 1) * PAGE_SIZE < total && <a className="chip" href={qs(urlBase, params, { page: String(page + 1) })}>Næste →</a>}
        </div>
      )}
    </>
  );
}
