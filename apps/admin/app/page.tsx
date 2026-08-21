// Dashboard (spec §8): per instance/site/day. The headline metric that sells
// the product — widget RPM vs display RPM — needs the display-side number from
// AY, so V1 shows the widget-side inputs: loads, viewability, CTR, counted CPC value.
import { query } from '@/lib/db';
import { pricingLabel } from '@/lib/wizard';

export const dynamic = 'force-dynamic';

interface Row {
  day: string;
  instance: string;
  site: string;
  loads: string;
  viewables: string;
  imps: string;
  clicks: string;
  rate: string | null;
}

export default async function Dashboard() {
  const totals = await query<{ loads: string; viewables: string; imps: string; clicks: string }>(
    `select coalesce(sum(loads),0)::text as loads, coalesce(sum(viewables),0)::text as viewables,
            coalesce(sum(product_impressions),0)::text as imps, coalesce(sum(clicks),0)::text as clicks
     from stats_hourly where hour >= now() - interval '7 days'`,
  );
  const rows = await query<Row>(
    `select to_char(date_trunc('day', s.hour), 'YYYY-MM-DD') as day,
            coalesce(wi.name, '—') as instance, coalesce(st.domain, '—') as site,
            sum(s.loads)::text as loads, sum(s.viewables)::text as viewables,
            sum(s.product_impressions)::text as imps, sum(s.clicks)::text as clicks,
            max(ia.rate)::text as rate
     from stats_hourly s
     left join widget_instance wi on wi.id = s.instance_id
     left join site st on st.id = s.site_id
     left join instance_advertiser ia on ia.instance_id = s.instance_id
     where s.hour >= now() - interval '14 days'
     group by 1, 2, 3
     order by 1 desc, 4 desc
     limit 100`,
  );
  // Shared widgets carry several advertisers, so the money view has to be per
  // advertiser: each one has its own price model, and CPC counted against the
  // wrong advertiser is worse than no number at all.
  const perAdvertiser = await query<{
    advertiser: string; widgets: string; loads: string; viewables: string; imps: string; clicks: string;
    pricing: { cpc?: { rate?: number }; cpm?: { rate?: number }; fixed?: { amount?: number }; affiliate?: unknown } | null;
  }>(
    `select coalesce(a.name, '—') as advertiser,
            count(distinct s.instance_id)::text as widgets,
            sum(s.loads)::text as loads, sum(s.viewables)::text as viewables,
            sum(s.product_impressions)::text as imps, sum(s.clicks)::text as clicks,
            (array_agg(ia.pricing order by ia.updated_at desc))[1] as pricing
     from stats_hourly s
     left join advertiser a on a.id = s.advertiser_id
     left join instance_advertiser ia on ia.instance_id = s.instance_id and ia.advertiser_id = s.advertiser_id
     where s.hour >= now() - interval '14 days'
     group by 1
     order by sum(s.clicks) desc, sum(s.loads) desc
     limit 50`,
  );
  const t = totals[0];
  const pct = (a: string, b: string) => (Number(b) ? ((Number(a) / Number(b)) * 100).toFixed(1) + '%' : '—');

  return (
    <>
      <h1>Dashboard — sidste 7 dage</h1>
      <div className="kpis">
        <div className="kpi"><div className="v">{t.loads}</div><div className="l">Widget loads</div></div>
        <div className="kpi"><div className="v">{pct(t.viewables, t.loads)}</div><div className="l">Viewability</div></div>
        <div className="kpi"><div className="v">{t.imps}</div><div className="l">Produktvisninger</div></div>
        <div className="kpi"><div className="v">{t.clicks}</div><div className="l">Kliks</div></div>
        <div className="kpi"><div className="v">{pct(t.clicks, t.viewables)}</div><div className="l">CTR (af viewable)</div></div>
      </div>

      <h2>Per annoncør (14 dage)</h2>
      <table>
        <thead>
          <tr><th>Annoncør</th><th>Widgets</th><th>Loads</th><th>Viewable</th><th>Produktvisn.</th><th>Kliks</th><th>CTR</th><th>Prismodel</th><th>Talt værdi</th></tr>
        </thead>
        <tbody>
          {perAdvertiser.length === 0 && <tr><td colSpan={9} className="muted">Ingen events endnu.</td></tr>}
          {perAdvertiser.map((r, i) => {
            const cpc = r.pricing?.cpc?.rate ?? 0;
            const cpm = r.pricing?.cpm?.rate ?? 0;
            const value = Number(r.clicks) * cpc + (Number(r.viewables) / 1000) * cpm;
            const models = pricingLabel(r.pricing as Record<string, unknown>);
            return (
              <tr key={i}>
                <td>{r.advertiser}</td><td>{r.widgets}</td><td>{r.loads}</td>
                <td>{pct(r.viewables, r.loads)}</td><td>{r.imps}</td><td>{r.clicks}</td>
                <td>{pct(r.clicks, r.viewables)}</td>
                <td>{models || <span className="muted">ikke sat</span>}</td>
                <td>{value > 0 ? value.toLocaleString('da-DK', { maximumFractionDigits: 0 }) + ' kr.' : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Per widget / dag (14 dage)</h2>
      <table>
        <thead>
          <tr><th>Dag</th><th>Widget</th><th>Site</th><th>Loads</th><th>Viewability</th><th>Produktvisn.</th><th>Kliks</th><th>CTR</th><th>Talt CPC-værdi</th></tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={9} className="muted">Ingen events endnu — kør rollup-cron, eller vent på trafik.</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.day}</td><td>{r.instance}</td><td>{r.site}</td>
              <td>{r.loads}</td><td>{pct(r.viewables, r.loads)}</td><td>{r.imps}</td><td>{r.clicks}</td>
              <td>{pct(r.clicks, r.viewables)}</td>
              <td>{r.rate ? (Number(r.clicks) * Number(r.rate)).toLocaleString('da-DK', { maximumFractionDigits: 0 }) + ' kr.' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 10 }}>
        CPC tælles og rapporteres i V1 selv om aftalen faktureres som fast sponsorat — det bygger rate card til V2.
      </p>
    </>
  );
}
