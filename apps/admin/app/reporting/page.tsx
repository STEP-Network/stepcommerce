// Reporting: the money view, grouped the way the business talks about it —
// per advertiser (who do we bill), per widget (what performs), per site
// (which publisher earns). Counted value = clicks × CPC + viewables/1000 × CPM
// per advertiser; nothing is invoiced from here yet.
import { query } from '@/lib/db';
import { basePathUrl } from '@/lib/base-path';
import { pricingLabel } from '@/lib/wizard';

export const dynamic = 'force-dynamic';

const GROUPS = [
  { id: 'advertiser', label: 'Pr. annoncør' },
  { id: 'widget', label: 'Pr. widget' },
  { id: 'site', label: 'Pr. site' },
] as const;
const RANGES = [
  { id: '7', label: '7 dage' },
  { id: '14', label: '14 dage' },
  { id: '30', label: '30 dage' },
  { id: '90', label: '90 dage' },
] as const;

interface Row {
  name: string;
  extra: string | null;
  loads: string;
  viewables: string;
  imps: string;
  clicks: string;
  pricing: { cpc?: { rate?: number }; cpm?: { rate?: number } } | null;
  cpc_value: string | null;
  cpm_value: string | null;
}

export default async function Reporting({
  searchParams,
}: {
  searchParams: Promise<{ by?: string; days?: string; advertiser?: string; site?: string }>;
}) {
  const sp = await searchParams;
  const by = GROUPS.some((g) => g.id === sp.by) ? sp.by! : 'advertiser';
  const days = RANGES.some((r) => r.id === sp.days) ? Number(sp.days) : 14;

  // Value is computed advertiser-correctly in ALL groupings: each stats row
  // joins ITS advertiser's rates, and the group sums the products. Grouping by
  // widget or site must never multiply one advertiser's clicks with another's
  // CPC just because they share a widget.
  const valueJoin = `
    left join instance_advertiser ia
      on ia.instance_id = s.instance_id and ia.advertiser_id = s.advertiser_id`;
  const valueCols = `
    sum(s.clicks * coalesce((ia.pricing #>> '{cpc,rate}')::numeric, 0))::text as cpc_value,
    sum((s.viewables / 1000.0) * coalesce((ia.pricing #>> '{cpm,rate}')::numeric, 0))::text as cpm_value`;

  let rows: Row[] = [];
  if (by === 'advertiser') {
    rows = await query<Row>(
      `select coalesce(a.name, '(ukendt)') as name,
              (count(distinct s.instance_id))::text || ' widgets' as extra,
              sum(s.loads)::text as loads, sum(s.viewables)::text as viewables,
              sum(s.product_impressions)::text as imps, sum(s.clicks)::text as clicks,
              (array_agg(ia.pricing) filter (where ia.pricing is not null))[1] as pricing,
              ${valueCols}
       from stats_hourly s
       left join advertiser a on a.id = s.advertiser_id
       ${valueJoin}
       where s.hour >= now() - ($1 || ' days')::interval
       group by 1 order by sum(s.clicks) desc, sum(s.loads) desc limit 200`,
      [days],
    );
  } else if (by === 'widget') {
    rows = await query<Row>(
      `select coalesce(wi.name, '(slettet widget)') as name,
              st.domain as extra,
              sum(s.loads)::text as loads, sum(s.viewables)::text as viewables,
              sum(s.product_impressions)::text as imps, sum(s.clicks)::text as clicks,
              null as pricing,
              ${valueCols}
       from stats_hourly s
       left join widget_instance wi on wi.id = s.instance_id
       left join site st on st.id = s.site_id
       ${valueJoin}
       where s.hour >= now() - ($1 || ' days')::interval
       group by 1, 2 order by sum(s.clicks) desc, sum(s.loads) desc limit 200`,
      [days],
    );
  } else {
    rows = await query<Row>(
      `select coalesce(st.domain, '(ukendt site)') as name,
              (count(distinct s.instance_id))::text || ' widgets' as extra,
              sum(s.loads)::text as loads, sum(s.viewables)::text as viewables,
              sum(s.product_impressions)::text as imps, sum(s.clicks)::text as clicks,
              null as pricing,
              ${valueCols}
       from stats_hourly s
       left join site st on st.id = s.site_id
       ${valueJoin}
       where s.hour >= now() - ($1 || ' days')::interval
       group by 1 order by sum(s.clicks) desc, sum(s.loads) desc limit 200`,
      [days],
    );
  }

  const daily = await query<{ day: string; loads: string; clicks: string }>(
    `select to_char(date_trunc('day', hour), 'DD/MM') as day,
            sum(loads)::text as loads, sum(clicks)::text as clicks
     from stats_hourly where hour >= now() - ($1 || ' days')::interval
     group by date_trunc('day', hour) order by date_trunc('day', hour)`,
    [days],
  );

  const totals = rows.reduce(
    (t, r) => ({
      loads: t.loads + Number(r.loads), viewables: t.viewables + Number(r.viewables),
      imps: t.imps + Number(r.imps), clicks: t.clicks + Number(r.clicks),
      value: t.value + Number(r.cpc_value ?? 0) + Number(r.cpm_value ?? 0),
    }),
    { loads: 0, viewables: 0, imps: 0, clicks: 0, value: 0 },
  );
  const pct = (a: number, b: number) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—');
  const kr = (n: number) => (n > 0 ? n.toLocaleString('da-DK', { maximumFractionDigits: 0 }) + ' kr.' : '—');
  const maxLoads = Math.max(1, ...daily.map((d) => Number(d.loads)));
  const qs = (patch: Record<string, string>) =>
    basePathUrl(`/reporting?${new URLSearchParams({ by, days: String(days), ...patch })}`);

  return (
    <>
      <h1>Rapportering</h1>
      <p className="muted">
        CPC og CPM tælles og rapporteres — der faktureres ikke herfra endnu. Talt værdi = klik × CPC +
        viewable visninger/1.000 × CPM, altid regnet med den annoncørs egne rater.
      </p>

      <div className="row" style={{ marginBottom: 18, justifyContent: 'space-between' }}>
        <span className="chipset">
          {GROUPS.map((g) => <a key={g.id} className={`chip ${by === g.id ? 'on' : ''}`} href={qs({ by: g.id })}>{g.label}</a>)}
        </span>
        <span className="chipset">
          {RANGES.map((r) => <a key={r.id} className={`chip ${String(days) === r.id ? 'on' : ''}`} href={qs({ days: r.id })}>{r.label}</a>)}
        </span>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="v">{totals.loads.toLocaleString('da-DK')}</div><div className="l">Widget loads</div></div>
        <div className="kpi"><div className="v">{pct(totals.viewables, totals.loads)}</div><div className="l">Viewability</div></div>
        <div className="kpi"><div className="v">{totals.imps.toLocaleString('da-DK')}</div><div className="l">Produktvisninger</div></div>
        <div className="kpi"><div className="v">{totals.clicks.toLocaleString('da-DK')}</div><div className="l">Kliks</div></div>
        <div className="kpi"><div className="v">{pct(totals.clicks, totals.viewables)}</div><div className="l">CTR (af viewable)</div></div>
        <div className="kpi"><div className="v">{kr(totals.value)}</div><div className="l">Talt værdi</div></div>
      </div>

      {daily.length > 1 && (
        <div className="card" style={{ marginBottom: 22 }}>
          <div className="muted" style={{ marginBottom: 8 }}>Loads pr. dag</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 72 }}>
            {daily.map((d, i) => (
              <div key={i} title={`${d.day}: ${d.loads} loads, ${d.clicks} klik`}
                   style={{ flex: 1, background: 'var(--purple)', opacity: .85, borderRadius: '3px 3px 0 0',
                            height: `${Math.max(3, (Number(d.loads) / maxLoads) * 100)}%` }} />
            ))}
          </div>
          <div className="muted" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span>{daily[0]?.day}</span><span>{daily[daily.length - 1]?.day}</span>
          </div>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>{GROUPS.find((g) => g.id === by)!.label.replace('Pr. ', '').replace(/^./, (c) => c.toUpperCase())}</th>
            <th></th><th>Loads</th><th>Viewability</th><th>Produktvisn.</th><th>Kliks</th><th>CTR</th>
            {by === 'advertiser' && <th>Prismodel</th>}
            <th>Talt værdi</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={9} className="muted">Ingen events i perioden — der kommer tal når widgets serveres på rigtige sider.</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i}>
              <td><b>{r.name}</b></td>
              <td className="muted">{r.extra ?? ''}</td>
              <td>{Number(r.loads).toLocaleString('da-DK')}</td>
              <td>{pct(Number(r.viewables), Number(r.loads))}</td>
              <td>{Number(r.imps).toLocaleString('da-DK')}</td>
              <td>{Number(r.clicks).toLocaleString('da-DK')}</td>
              <td>{pct(Number(r.clicks), Number(r.viewables))}</td>
              {by === 'advertiser' && <td>{pricingLabel(r.pricing as Record<string, unknown>) || <span className="muted">ikke sat</span>}</td>}
              <td>{kr(Number(r.cpc_value ?? 0) + Number(r.cpm_value ?? 0))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
