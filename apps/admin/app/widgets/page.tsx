// Widget list + "new widget". Everything the old Template/Site/Instance/
// Placement/Preview tabs did happens inside one widget now.
import Link from 'next/link';
import { query } from '@/lib/db';
import { createWidget } from './[id]/actions';
import { STEPS } from '@/lib/wizard';
import { assetUrl } from '@/lib/assets';

export const dynamic = 'force-dynamic';

export default async function Widgets({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  const widgets = await query<{
    id: string; name: string; status: string; widget_type: string; mode: string; wizard_step: number;
    domain: string; layout_type: string; code: string | null;
    advertisers: string[]; logos: (string | null)[]; sources: string; rules: string;
    clicks: string; loads: string;
  }>(
    `select wi.id, wi.name, wi.status, wi.widget_type, wi.mode, wi.wizard_step,
            s.domain, wt.layout_type, p.code,
            coalesce((select array_agg(a.name order by a.name) from instance_advertiser ia
                       join advertiser a on a.id = ia.advertiser_id where ia.instance_id = wi.id), '{}') as advertisers,
            coalesce((select array_agg(a.logo_asset_id) from instance_advertiser ia
                       join advertiser a on a.id = ia.advertiser_id where ia.instance_id = wi.id), '{}') as logos,
            (select count(*) from instance_source src where src.instance_id = wi.id)::text as sources,
            (select count(*) from kv_mapping m where m.instance_id = wi.id)::text as rules,
            coalesce((select sum(clicks) from stats_hourly h where h.instance_id = wi.id), 0)::text as clicks,
            coalesce((select sum(loads) from stats_hourly h where h.instance_id = wi.id), 0)::text as loads
     from widget_instance wi
     join site s on s.id = wi.site_id
     join widget_template wt on wt.id = wi.template_id
     left join placement p on p.default_instance_id = wi.id
     where wi.status <> 'archived'
     order by wi.updated_at desc`,
  );
  const sites = await query<{ id: string; domain: string; publisher: string }>(
    'select id, domain, publisher from site order by domain',
  );

  return (
    <>
      <h1>Widgets</h1>
      <p className="muted">Én widget = ét site, én embed-kode. Wizarden går fra type til færdig kode i {STEPS.length} trin.</p>
      {error && <p className="bad">{error}</p>}

      <table>
        <thead>
          <tr><th>Widget</th><th>Site</th><th>Type</th><th>Annoncører</th><th>Kilder</th><th>Targeting</th><th>Visninger</th><th>Klik</th><th>Status</th></tr>
        </thead>
        <tbody>
          {widgets.length === 0 && <tr><td colSpan={9} className="muted">Ingen widgets endnu — opret én nedenfor.</td></tr>}
          {widgets.map((w) => (
            <tr key={w.id}>
              <td>
                <Link href={`/widgets/${w.id}?step=${STEPS[Math.min(Math.max(w.wizard_step, 1), STEPS.length) - 1].slug}`}><b>{w.name}</b></Link>
                <div className="muted">{w.code ? <code>{w.code}</code> : 'intet placement'} · {w.layout_type}</div>
              </td>
              <td>{w.domain}</td>
              <td>{w.widget_type === 'takeover' ? 'Takeover' : 'Produkt-match'}{w.mode === 'shared' ? ' · delt' : ''}</td>
              <td>
                {w.advertisers.length === 0 ? <span className="muted">—</span> : (
                  <>
                    {w.logos.filter(Boolean).slice(0, 3).map((l) => <img className="logo" key={l} src={assetUrl(l!)} alt="" style={{ marginRight: 4 }} />)}
                    <div className="muted">{w.advertisers.join(', ')}</div>
                  </>
                )}
              </td>
              <td>{w.sources}</td>
              <td>{w.rules}</td>
              <td>{Number(w.loads).toLocaleString('da-DK')}</td>
              <td>{Number(w.clicks).toLocaleString('da-DK')}</td>
              <td><span className={`status ${w.status}`}>{w.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Ny widget</h2>
      {sites.length === 0 ? (
        <p className="warn">Opret først et <Link href="/sites">site</Link> — en widget hører altid til ét domæne.</p>
      ) : (
        <form className="panel" action={createWidget}>
          <label>Navn<input name="name" required placeholder="Vin til aftensmaden — Madens Verden" /></label>
          <label>Site
            <select name="site_id" required>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.domain} ({s.publisher})</option>)}
            </select>
          </label>
          <label>Hvad slags widget?
            <select name="widget_type" defaultValue="product_match">
              <option value="product_match">Produkt-matching (CPC, drevet af XML-feeds)</option>
              <option value="takeover">Takeover / brandflade (feed er valgfrit)</option>
            </select>
          </label>
          <button>Start wizard</button>
        </form>
      )}
    </>
  );
}
