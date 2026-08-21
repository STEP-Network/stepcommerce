// Pre-flight check (spec §2/§11 "live preview"): renders a real placement with
// real resolved feed data, using the actual widget runtime, before anything is
// set live. Draft instances are included, so this is the advertiser sign-off
// screen as well as the ops sanity check.
import { query } from '@/lib/db';
import { resolveServe } from '@/lib/resolve';

export const dynamic = 'force-dynamic';

const EXAMPLES: Record<string, string> = {
  'Svinekød (produktions-KV fra madensverden.dk)':
    'mv_page=artikel;mv_ingredients=skinkeschnitzler, salt og friskkværnet peber, rosmarin, Fanø skinke, hvedemel;mv_cat=aftensmad;Domain=madensverden.dk',
  'Fisk': 'mv_page=artikel;mv_ingredients=torsk, citron, dild;mv_cat=aftensmad',
  'Ingen match (skal skjule widgetten)': 'mv_page=artikel;mv_ingredients=broccoli, quinoa',
  'limited_ads (skal ikke serveres)': 'mv_page=artikel;mv_ingredients=torsk;limited_ads=true',
};

export default async function Preview({
  searchParams,
}: {
  searchParams: Promise<{ placement?: string; kv?: string; device?: string }>;
}) {
  const sp = await searchParams;
  const placements = await query<{ code: string; name: string; site: string }>(
    `select p.code, p.name, s.domain as site from placement p
     join site s on s.id = p.site_id order by p.created_at desc`,
  );
  const placement = sp.placement ?? placements[0]?.code ?? '';
  const kvString = sp.kv ?? Object.values(EXAMPLES)[0];
  const device = sp.device ?? 'desktop';

  const kv: Record<string, string> = {};
  for (const pair of kvString.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) kv[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }

  let resolved: Awaited<ReturnType<typeof resolveServe>> | null = null;
  let error: string | null = null;
  if (placement) {
    try {
      resolved = await resolveServe({
        placementCode: placement,
        kv,
        origin: process.env.PUBLIC_ORIGIN ?? '',
        deviceClass: device,
        preview: true,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  const qs = `placement=${encodeURIComponent(placement)}&kv=${encodeURIComponent(kvString)}&device=${encodeURIComponent(device)}`;
  const frameUrl = `/stepcommerce/api/preview-frame?${qs}`;

  return (
    <>
      <h1>Preview</h1>
      <p className="muted">
        Renderer et rigtigt placement med rigtige feed-data gennem den rigtige widget-runtime.
        Draft-instanser vises også, så en opsætning kan godkendes før den sættes live.
      </p>

      <form className="panel" method="get">
        <label>Placement
          <select name="placement" defaultValue={placement}>
            {placements.map((p) => (
              <option key={p.code} value={p.code}>{p.code} — {p.site} ({p.name})</option>
            ))}
          </select>
        </label>
        <label>Key-values &mdash; format: key=value;key2=value2
          <textarea name="kv" defaultValue={kvString} />
        </label>
        <label>Device
          <select name="device" defaultValue={device}>
            <option value="desktop">desktop</option><option value="tablet">tablet</option><option value="mobile">mobile</option>
          </select>
        </label>
        <button>Render</button>
      </form>

      <h2>Eksempler</h2>
      <ul className="muted" style={{ paddingLeft: 18 }}>
        {Object.entries(EXAMPLES).map(([label, value]) => (
          <li key={label} style={{ marginBottom: 4 }}>
            <a href={`?placement=${encodeURIComponent(placement)}&kv=${encodeURIComponent(value)}&device=${device}`}>{label}</a>
          </li>
        ))}
      </ul>

      <h2>Resultat</h2>
      {error && <pre><code>{error}</code></pre>}
      {resolved && (
        <p>
          {resolved.render ? (
            <>
              <span className="status live">renderer</span>{' '}
              {resolved.products?.length} produkter · template <code>{resolved.template}</code>
              {resolved.meta?.chips?.length ? <> · chips: {resolved.meta.chips.join(' · ')}</> : null}
            </>
          ) : (
            <>
              <span className="status failing">renderer intet</span>{' '}
              årsag: <code>{resolved.reason}</code>
              {resolved.reason === 'instance_not_live' && ' — instansen er draft/paused'}
              {resolved.reason === 'no_mappings' && ' — instansen har ingen KV-mappings'}
              {resolved.reason === 'no_products' && ' — mapping matchede, men ingen produkter er renderbare (stale feed, udsolgt, eller regel matcher intet)'}
              {resolved.reason === 'no_rule_match' && ' — ingen placement-regel matchede sidens key-values'}
            </>
          )}
        </p>
      )}

      <h2>Sådan ser den ud</h2>
      <iframe
        src={frameUrl}
        title="Widget preview"
        style={{
          width: '100%',
          maxWidth: device === 'mobile' ? 390 : device === 'tablet' ? 800 : '100%',
          height: 620,
          border: '1px solid #d8d3ec',
          borderRadius: 10,
          background: '#f3efe3',
        }}
      />
      <p className="muted" style={{ marginTop: 8 }}>
        Rammen er en selvstændig side, så widgetten kører præcis som på et publisher-site.
        Den renderes i Shadow DOM — publisher-CSS kan ikke påvirke den, og den kan ikke påvirke siden.
      </p>
    </>
  );
}
