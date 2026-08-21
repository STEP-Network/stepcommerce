// Step 2 — who is in the widget. Advertisers are chosen BEFORE products, so the
// product step only ever shows the chosen advertisers' feeds. More than one
// advertiser makes the widget shared, and the slots rotate fairly between them.
import Link from 'next/link';
import { query } from '@/lib/db';
import { assetUrl } from '@/lib/assets';
import type { AdvertiserSummary, Widget } from '@/lib/wizard';
import { addAdvertiser, removeAdvertiser } from './actions';

export default async function StepAdvertisers({
  w,
  advertisers,
}: {
  w: Widget;
  advertisers: AdvertiserSummary[];
}) {
  const chosen = new Set(advertisers.map((a) => a.advertiser_id));
  const all = await query<{
    id: string; name: string; logo_asset_id: string | null; feeds: string; products: string;
  }>(
    `select a.id, a.name, a.logo_asset_id,
            (select count(*) from feed f where f.advertiser_id = a.id and f.type <> 'manual')::text as feeds,
            (select count(*) from product p join feed f on f.id = p.feed_id
              where f.advertiser_id = a.id and p.available)::text as products
     from advertiser a where a.status = 'active' order by a.name`,
  );

  return (
    <>
      <p className="hint">
        Vælg de annoncører der skal være med i widgetten. Produkt-trinnet viser kun de valgte annoncørers
        feeds. Vælger du flere, bliver widgetten <b>delt</b>, og pladserne fordeles fair mellem dem —
        vægten kan justeres under Monetisering.
      </p>

      {all.length === 0 && (
        <p className="warn">
          Ingen annoncører endnu. Opret dem under <Link href="/advertisers">Annoncører</Link> — med logo,
          kontaktperson og feed — og kom så tilbage hertil.
        </p>
      )}

      <div className="advgrid">
        {all.map((a) => {
          const picked = chosen.has(a.id);
          return (
            <div className={`advcard ${picked ? 'picked' : ''}`} key={a.id}>
              <div className="who">
                {a.logo_asset_id
                  ? <img className="logo" src={assetUrl(a.logo_asset_id)} alt="" />
                  : <span className="thumb-sm" style={{ width: 30, height: 30 }} />}
                <div>
                  <b>{a.name}</b>
                  <div className="muted">{a.feeds} feed{a.feeds === '1' ? '' : 's'} · {a.products} produkter</div>
                </div>
              </div>
              <form action={picked ? removeAdvertiser : addAdvertiser}>
                <input type="hidden" name="id" value={w.id} />
                <input type="hidden" name="advertiser_id" value={a.id} />
                <button className={`small ${picked ? 'danger' : ''}`}>{picked ? 'Fjern fra widget' : 'Vælg annoncør'}</button>
              </form>
            </div>
          );
        })}
      </div>

      <p className="muted" style={{ marginTop: 14 }}>
        Mangler annoncøren? <Link href="/advertisers">Opret den her</Link> — så ligger logo og kontakter klar
        til rapporteringen.
      </p>

      <div className="stepnav">
        <Link className="chip" href={`/widgets/${w.id}?step=type`}>← Type &amp; site</Link>
        <Link className="chip on" href={`/widgets/${w.id}?step=sources`}>
          Produkter ({advertisers.length} annoncør{advertisers.length === 1 ? '' : 'er'} valgt) →
        </Link>
      </div>
    </>
  );
}
