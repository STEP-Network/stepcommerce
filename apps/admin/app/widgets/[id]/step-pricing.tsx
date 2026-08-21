// Step 3 — how the widget earns money. Priced per advertiser, because a shared
// widget can have one chain on CPC, another on CPM plus CPC, and a third on
// affiliate only. Combinations are allowed: everything checked is stored, and
// the first one that would be billed becomes the reported primary model.
import Link from 'next/link';
import type { AdvertiserSummary, SourceSummary, Widget } from '@/lib/wizard';
import { savePricing } from './actions';

interface Pricing {
  cpc?: { rate?: number | null };
  cpm?: { rate?: number | null };
  fixed?: { amount?: number | null; period?: string | null };
  affiliate?: { network?: string | null; commission?: string | null; deeplink_template?: string | null };
}

export default function StepPricing({
  w,
  advertisers,
  sources,
}: {
  w: Widget;
  advertisers: AdvertiserSummary[];
  sources: SourceSummary[];
}) {
  return (
    <>
      <p className="hint">
        CPC <b>tælles og rapporteres</b> i V1, men faktureres ikke endnu — raten her er rate card til
        fakturering senere. CPM regnes på viewable visninger. Vælger du affiliate, sendes klik gennem
        annoncørens deeplink, så netværket kan attribuere dem.
      </p>

      {advertisers.length === 0 && (
        <p className="warn">
          Ingen annoncører endnu — tilføj en <Link href={`/widgets/${w.id}?step=sources`}>produktkilde</Link> først,
          så følger annoncøren med.
        </p>
      )}

      {advertisers.map((a) => {
        const p = (a.pricing ?? {}) as Pricing;
        const own = sources.filter((s) => s.advertiser_id === a.advertiser_id);
        return (
          <form className="card" action={savePricing} key={a.advertiser_id} style={{ marginBottom: 14, display: 'grid', gap: 10 }}>
            <input type="hidden" name="id" value={w.id} />
            <input type="hidden" name="advertiser_id" value={a.advertiser_id} />
            <div>
              <b>{a.name}</b>
              <div className="muted">
                {own.length} kilde{own.length === 1 ? '' : 'r'} · {own.reduce((n, s) => n + Math.max(0, s.matches), 0)} produkter i puljen
              </div>
            </div>

            <label className="check"><input type="checkbox" name="use_cpc" defaultChecked={!!p.cpc} /> CPC — pris pr. klik</label>
            <div className="row"><label>Kr. pr. klik<input name="cpc_rate" defaultValue={p.cpc?.rate ?? ''} placeholder="2,50" /></label></div>

            <label className="check"><input type="checkbox" name="use_cpm" defaultChecked={!!p.cpm} /> CPM — pris pr. 1.000 viewable visninger</label>
            <div className="row"><label>Kr. pr. 1.000<input name="cpm_rate" defaultValue={p.cpm?.rate ?? ''} placeholder="25" /></label></div>

            <label className="check"><input type="checkbox" name="use_fixed" defaultChecked={!!p.fixed} /> Fast pris for perioden</label>
            <div className="row">
              <label>Beløb (kr.)<input name="fixed_amount" defaultValue={p.fixed?.amount ?? ''} placeholder="15000" /></label>
              <label>Periode<input name="fixed_period" defaultValue={p.fixed?.period ?? ''} placeholder="uge 34-36" /></label>
            </div>

            <label className="check"><input type="checkbox" name="use_affiliate" defaultChecked={!!p.affiliate} /> Affiliate</label>
            <div className="row">
              <label>Netværk<input name="aff_network" defaultValue={p.affiliate?.network ?? ''} placeholder="Adtraction" /></label>
              <label>Kommission<input name="aff_commission" defaultValue={p.affiliate?.commission ?? ''} placeholder="6 %" /></label>
            </div>
            <label>
              Deeplink-template
              <input name="aff_deeplink" defaultValue={p.affiliate?.deeplink_template ?? ''}
                     placeholder="https://track.adtraction.com/t/t?a=123&url={url}&epi={click_id}" />
            </label>
            <p className="muted" style={{ margin: 0 }}>
              <code>{'{url}'}</code> erstattes med produktets landingsside, <code>{'{click_id}'}</code> med vores
              klik-id. Har et enkelt produkt sin egen affiliate-URL, vinder den over templaten.
            </p>

            {w.mode === 'shared' && (
              <label>
                Vægt i rotationen (valgfrit)
                <input name="weight" type="number" min={1} defaultValue={a.weight ?? ''} placeholder="1" />
              </label>
            )}
            {w.mode === 'shared' && (
              <p className="muted" style={{ margin: 0 }}>
                Pladserne fordeles på tur mellem annoncørerne. Vægt 2 betyder to pladser pr. runde — brug den
                kun hvis en annoncør har betalt for mere plads.
              </p>
            )}

            <button className="small">Gem priser for {a.name}</button>
          </form>
        );
      })}

      <div className="stepnav">
        <Link className="chip" href={`/widgets/${w.id}?step=sources`}>← Produkter</Link>
        <Link className="chip on" href={`/widgets/${w.id}?step=design`}>Design →</Link>
      </div>
    </>
  );
}
