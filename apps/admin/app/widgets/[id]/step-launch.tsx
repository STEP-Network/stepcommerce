// Step 6 — the handover. A checklist of what still blocks the widget, then the
// two things a publisher actually needs: a script tag for a direct embed, and a
// GAM HTML5 creative whose macro list covers every key the targeting uses.
import Link from 'next/link';
import { embedSnippet, gamSnippet, macroKeys } from '@/lib/snippet';
import { basePathUrl } from '@/lib/base-path';
import { pricingLabel, type AdvertiserSummary, type Blocker, type SourceSummary, type TargetingRule, type Widget } from '@/lib/wizard';
import { deleteWidget, ensurePlacement, setStatus } from './actions';

export default function StepLaunch({
  w,
  blockers,
  targeting,
  advertisers,
  sources,
}: {
  w: Widget;
  blockers: Blocker[];
  targeting: TargetingRule[];
  advertisers: AdvertiserSummary[];
  sources: SourceSummary[];
}) {
  const hard = blockers.filter((b) => b.hard);
  const soft = blockers.filter((b) => !b.hard);
  const code = w.placement_code;
  const kvKeys = macroKeys([], targeting.map((t) => t.page_key));

  return (
    <>
      <div className="cols">
        <div>
          <h2 style={{ marginTop: 0 }}>Klar til at gå live?</h2>
          {hard.length === 0 && soft.length === 0 && <p className="ok">Alt er på plads.</p>}
          {hard.map((b, i) => (
            <p className="bad" key={i}>{b.text} <Link href={`/widgets/${w.id}?step=${b.step}`}>Ret det →</Link></p>
          ))}
          {soft.map((b, i) => (
            <p className="warn" key={i}>{b.text} <Link href={`/widgets/${w.id}?step=${b.step}`}>Se →</Link></p>
          ))}

          <h2>Opsummering</h2>
          <table>
            <tbody>
              <tr><th>Site</th><td>{w.domain} ({w.publisher})</td></tr>
              <tr><th>Type</th><td>{w.widget_type === 'takeover' ? 'Takeover / brandflade' : 'Produkt-matching'}{w.mode === 'shared' ? ' · delt widget' : ''}</td></tr>
              <tr><th>Layout</th><td>{w.layout_type} · {w.slot_count?.default ?? 3} pladser</td></tr>
              <tr><th>Annoncører</th><td>{advertisers.map((a) => `${a.name} (${pricingLabel(a.pricing) || 'ingen pris'})`).join(', ') || '—'}</td></tr>
              <tr><th>Produktpulje</th><td>{sources.reduce((n, s) => n + Math.max(0, s.matches), 0)} fra {sources.length} kilde{sources.length === 1 ? '' : 'r'}</td></tr>
              <tr><th>Targeting</th><td>{targeting.length} regler på {[...new Set(targeting.map((t) => t.page_key))].join(', ') || 'ingen keys'}</td></tr>
              <tr><th>Placement</th><td>{code ? <code>{code}</code> : '—'}</td></tr>
            </tbody>
          </table>

          <h2>Status</h2>
          <form className="panel" action={setStatus}>
            <input type="hidden" name="id" value={w.id} />
            <label>Sæt status
              <select name="status" defaultValue={w.status}>
                <option value="draft">draft — kun preview</option>
                <option value="live">live — serveres på sitet</option>
                <option value="paused">paused</option>
                <option value="archived">archived</option>
              </select>
            </label>
            <p className="muted" style={{ margin: 0 }}>
              &quot;live&quot; afvises hvis noget af ovenstående stadig blokerer — også hvis siden er forældet.
            </p>
            <button>Gem status</button>
          </form>

          <details style={{ marginTop: 20 }}>
            <summary className="muted">Slet widgetten</summary>
            <form action={deleteWidget} style={{ marginTop: 8 }}>
              <input type="hidden" name="id" value={w.id} />
              <button className="small danger">Slet widget, placement og design permanent</button>
            </form>
          </details>
        </div>

        <div>
          <h2 style={{ marginTop: 0 }}>Embed-kode (direkte i sidens HTML)</h2>
          {code ? <pre><code>{embedSnippet(code)}</code></pre> : (
            <form className="panel" action={ensurePlacement}>
              <input type="hidden" name="id" value={w.id} />
              <p className="warn" style={{ margin: 0 }}>Widgetten har intet placement, så der er ingen embed-kode.</p>
              <button className="small">Opret placement og embed-kode</button>
            </form>
          )}
          <p className="muted">
            Sættes hvor widgetten skal stå. Loaderen læser sidens key-values fra googletag → dataLayer →
            <code>data-kv</code>, så publisher behøver ikke sende noget manuelt.
          </p>

          <h2>GAM HTML5-kreativ</h2>
          {code ? <pre><code>{gamSnippet(code, kvKeys)}</code></pre> : null}
          <p className="muted">
            I GAM kommer key-values ind gennem <code>%%PATTERN%%</code>-makroer. Vi læser aldrig googletag
            inde fra en SafeFrame — derfor skal makrolisten indeholde alle nøgler targeting bruger:{' '}
            {kvKeys.map((k) => <code key={k} style={{ marginRight: 4 }}>{k}</code>)}
          </p>
          {targeting.length === 0 && (
            <p className="warn">Ingen targeting-nøgler endnu, så kreativet sender kun <code>limited_ads</code>.</p>
          )}

          <h2>Før du sender koden videre</h2>
          <ul style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>
            <li><Link href={`/widgets/${w.id}?step=design`}>Se den i preview</Link> med de key-values sitet reelt sender.</li>
            <li>Tjek <Link href="/health">Health</Link> efter første trafik — widgetten fejler tavst, så det er
                der man ser hvorfor den ikke renderede.</li>
            <li>Feed-friskhed: data over 24 timer gamle renderes aldrig. Det er markedsføringsloven, ikke en indstilling.</li>
          </ul>
          {code && (
            <p>
              <a href={basePathUrl(`/api/preview-frame?placement=${encodeURIComponent(code)}`)} target="_blank" rel="noreferrer">
                Åbn preview i eget vindue →
              </a>
            </p>
          )}
        </div>
      </div>
    </>
  );
}
