// Operability screen: is anything actually serving, and are the feeds alive?
// The widget fails silent by design, so without this page a misspelled
// key-value looks identical to "no traffic yet".
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const REASON_HELP: Record<string, string> = {
  rendered: 'Widget serveret',
  no_rule_match: 'Ingen placement-regel matchede sidens key-values (Level A)',
  no_products: 'Mapping matchede, men ingen renderbare produkter (stale feed, udsolgt, eller regel matcher intet)',
  no_mappings: 'Instansen har ingen KV-mappings og intet eksplicit default-sæt',
  instance_not_live: 'Instansen er draft/paused',
  limited_ads: 'Siden sendte limited_ads=true',
  unknown_placement: 'Placement-koden findes ikke, eller er paused',
  no_instance: 'Reglen peger på en instans der ikke findes',
  misconfigured_origin: 'PUBLIC_ORIGIN er ikke sat i miljøet',
  error: 'Uventet fejl under resolve',
};

export default async function Health() {
  const decisions = await query<{ code: string; reason: string; n: string }>(
    `select p.code, d.reason, sum(d.count)::text as n
     from serve_decision d join placement p on p.id = d.placement_id
     where d.hour >= now() - interval '48 hours'
     group by 1, 2 order by 1, 3 desc`,
  );
  const feeds = await query<{
    name: string; advertiser: string; status: string; last_fetch: string | null;
    content_changed: string | null; products: string; attempts: string; failures: string; last_error: string | null;
  }>(
    `select f.name, a.name as advertiser, f.status,
            to_char(f.last_fetch_at, 'YYYY-MM-DD HH24:MI') as last_fetch,
            to_char(f.content_changed_at, 'YYYY-MM-DD HH24:MI') as content_changed,
            (select count(*) from product p where p.feed_id = f.id and p.available)::text as products,
            (select count(*) from feed_fetch_log l where l.feed_id = f.id and l.ts > now() - interval '7 days')::text as attempts,
            (select count(*) from feed_fetch_log l where l.feed_id = f.id and l.ts > now() - interval '7 days' and not l.ok)::text as failures,
            (select l.error from feed_fetch_log l where l.feed_id = f.id and not l.ok order by l.ts desc limit 1) as last_error
     from feed f join advertiser a on a.id = f.advertiser_id
     order by f.status <> 'healthy' desc, f.name`,
  );

  const byPlacement = new Map<string, { reason: string; n: string }[]>();
  for (const d of decisions) {
    const list = byPlacement.get(d.code) ?? [];
    list.push({ reason: d.reason, n: d.n });
    byPlacement.set(d.code, list);
  }

  return (
    <>
      <h1>Health</h1>

      <h2>Serve-beslutninger (48 timer)</h2>
      {byPlacement.size === 0 && (
        <p className="muted">Ingen serve-kald registreret endnu. Ingen trafik — eller embed-tagget er ikke installeret.</p>
      )}
      {[...byPlacement].map(([code, rows]) => {
        const total = rows.reduce((s, r) => s + Number(r.n), 0);
        const rendered = Number(rows.find((r) => r.reason === 'rendered')?.n ?? 0);
        return (
          <div key={code} style={{ marginBottom: 18 }}>
            <h2 style={{ marginBottom: 6 }}>
              <code>{code}</code> — {total} kald,{' '}
              <span className={`status ${rendered / total > 0.5 ? 'live' : 'stale'}`}>
                {((rendered / total) * 100).toFixed(0)}% renderet
              </span>
            </h2>
            <table>
              <thead><tr><th>Årsag</th><th>Antal</th><th>Betydning</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.reason}>
                    <td><code>{r.reason}</code></td>
                    <td>{r.n}</td>
                    <td className="muted">{REASON_HELP[r.reason] ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      <h2>Feed-sundhed</h2>
      <table>
        <thead>
          <tr><th>Feed</th><th>Advertiser</th><th>Status</th><th>Produkter</th><th>Sidste fetch</th><th>Indhold ændret</th><th>Uptime 7d</th><th>Seneste fejl</th></tr>
        </thead>
        <tbody>
          {feeds.length === 0 && <tr><td colSpan={8} className="muted">Ingen feeds oprettet.</td></tr>}
          {feeds.map((f) => {
            const attempts = Number(f.attempts);
            const uptime = attempts ? (100 * (attempts - Number(f.failures)) / attempts).toFixed(1) + '%' : '—';
            return (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td>{f.advertiser}</td>
                <td><span className={`status ${f.status}`}>{f.status}</span></td>
                <td>{f.products}</td>
                <td>{f.last_fetch ?? 'aldrig'}</td>
                <td>{f.content_changed ?? '—'}</td>
                <td>{uptime}</td>
                <td className="muted">{f.last_error?.slice(0, 60) ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 10 }}>
        &quot;Indhold ændret&quot; er sidste gang feedets indhold faktisk var forskelligt. Står den stille
        mens fetch bliver grøn, er annoncørens feed frosset — og priserne må ikke renderes (spec §4.4).
      </p>
    </>
  );
}
