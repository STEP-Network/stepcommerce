// Step 1 — what are we building, and where does it live. The site decides which
// key-values targeting can use later, so it is picked before anything else.
import Link from 'next/link';
import type { Widget } from '@/lib/wizard';
import { saveType } from './actions';

export default function StepType({ w }: { w: Widget }) {
  const keys = w.kv_taxonomy?.keys ?? [];
  return (
    <>
      <div className="cols">
        <div>
          <form className="panel" action={saveType} style={{ maxWidth: 'none' }}>
            <input type="hidden" name="id" value={w.id} />
            <label>Navn på widgetten<input name="name" defaultValue={w.name} required /></label>
            <fieldset style={{ border: 0, display: 'grid', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#3d3568' }}>Widget-type</span>
              <label className="check">
                <input type="radio" name="widget_type" value="product_match" defaultChecked={w.widget_type !== 'takeover'} />
                <span>
                  Produkt-matching
                  <div className="muted" style={{ fontWeight: 400 }}>
                    Produkter fra XML-feeds matches mod sidens indhold. Afregnes typisk pr. klik (CPC).
                  </div>
                </span>
              </label>
              <label className="check">
                <input type="radio" name="widget_type" value="takeover" defaultChecked={w.widget_type === 'takeover'} />
                <span>
                  Takeover / brandflade
                  <div className="muted" style={{ fontWeight: 400 }}>
                    Stor brandingflade — fx Harald Nyborg-eksemplet. Feed er valgfrit; uden feed renderer den
                    stadig, med feed kan den vise produkter oveni.
                  </div>
                </span>
              </label>
            </fieldset>
            <button>Gem og fortsæt →</button>
          </form>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Site: {w.domain}</h2>
          <p className="muted">{w.publisher}</p>
          <p className="muted" style={{ marginTop: 8 }}>
            En widget hører til ét domæne. Skal den samme opsætning køre på flere sites, laver du én widget pr.
            site — så kan targeting, priser og design følge det enkelte site.
          </p>
          <h2>Key-values dette site kan sende</h2>
          {keys.length === 0 ? (
            <p className="warn">
              Sitet har ingen keys endnu. Tilføj dem under <Link href={`/sites/${w.site_id}`}>Sites → {w.domain}</Link>,
              ellers har du ikke noget at targete på i trin 5.
            </p>
          ) : (
            <table>
              <thead><tr><th>Key</th><th>Værdier</th></tr></thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.key}>
                    <td><code>{k.key}</code>{k.multi ? <div className="muted">multi-value</div> : null}</td>
                    <td>
                      {(k.values ?? []).length
                        ? <span className="chipset">{k.values!.slice(0, 12).map((v) => <span className="chip" key={v}>{v}</span>)}</span>
                        : <span className="muted">fri tekst</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p style={{ marginTop: 10 }}>
            <Link href={`/sites/${w.site_id}`}>Rediger sitets keys →</Link>
          </p>
        </div>
      </div>
    </>
  );
}
