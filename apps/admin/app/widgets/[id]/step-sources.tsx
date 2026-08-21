// Step 2 — where the products come from. This is the screen that makes a shared
// widget possible: one source per advertiser feed, each with its own conditions
// and its own cap, so a single wine widget can carry 10 products from one
// chain, 100 from another and 2 hand-picked from a third.
import Link from 'next/link';
import { query } from '@/lib/db';
import { RULE_FIELDS, RULE_OPERATORS, type RuleNode } from '@/lib/rules';
import { pricingLabel, type AdvertiserSummary, type SourceSummary, type Widget } from '@/lib/wizard';
import { addCondition, addSource, removeCondition, removeSource, setConditionsJson, setSourceCap } from './actions';

function describe(node: RuleNode): string {
  const leaf = node as { field?: string; operator?: string; value?: unknown };
  const label = RULE_FIELDS.find((f) => f.field === leaf.field)?.label ?? leaf.field ?? '?';
  const op = RULE_OPERATORS.find((o) => o.op === leaf.operator)?.label ?? leaf.operator ?? '?';
  const value = Array.isArray(leaf.value) ? leaf.value.join(', ') : String(leaf.value ?? '');
  return leaf.operator === 'exists' ? `${label} ${op}` : `${label} ${op} "${value}"`;
}

function conditionList(conditions: unknown): RuleNode[] {
  if (!conditions) return [];
  if (Array.isArray(conditions)) return conditions as RuleNode[];
  const c = conditions as { all?: RuleNode[]; any?: RuleNode[] };
  return c.all ?? c.any ?? [];
}

export default async function StepSources({
  w,
  sources,
  advertisers,
  feedIssues,
}: {
  w: Widget;
  sources: SourceSummary[];
  advertisers: AdvertiserSummary[];
  feedIssues: { demo: boolean; unhealthy: string[] };
}) {
  const feeds = await query<{ id: string; name: string; type: string; status: string; advertiser: string; advertiser_id: string; products: string }>(
    `select f.id, f.name, f.type, f.status, a.name as advertiser, a.id as advertiser_id,
            (select count(*) from product p where p.feed_id = f.id and p.available)::text as products
     from feed f join advertiser a on a.id = f.advertiser_id
     where a.status = 'active'
     order by a.name, f.type = 'manual', f.name`,
  );
  const slots = w.slot_count?.default ?? 3;
  const pool = sources.reduce((n, s) => n + Math.max(0, s.matches), 0);
  const takeover = w.widget_type === 'takeover';

  return (
    <>
      {takeover && (
        <p className="hint">
          Takeover-widgets må godt stå uden produkter — så er det ren branding. Tilføjer du kilder, vises
          produkterne oveni brandfladen.
        </p>
      )}
      {!takeover && (
        <p className="hint">
          Widgetten har <b>{slots} pladser</b> (kan ændres i trin 4). Tilføj en kilde pr. feed, sæt
          betingelserne for netop det feed, og sæt evt. et loft. Har flere annoncører kilder i samme widget,
          bliver den <b>delt</b>, og pladserne fordeles på tur, så den mindste katalog ikke bliver kvalt af
          den største.
        </p>
      )}
      {feedIssues.demo && <p className="bad">En kilde peger på demo-feedet. Skift til annoncørens rigtige feed før du går live.</p>}
      {feedIssues.unhealthy.length > 0 && (
        <p className="bad">Ikke-healthy feeds: {feedIssues.unhealthy.join(', ')}. Stale data må aldrig renderes.</p>
      )}

      <h2>Kilder ({sources.length}) · samlet pulje {pool} produkter</h2>
      {sources.length === 0 && <p className="muted">Ingen kilder endnu.</p>}

      {sources.map((s) => {
        const conditions = conditionList(s.conditions);
        return (
          <div className="card" key={s.id} style={{ marginBottom: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <b>{s.advertiser}</b> · <Link href={`/feeds/${s.feed_id}`}>{s.feed}</Link>{' '}
                <span className={`status ${s.feed_status}`}>{s.feed_status}</span>
                {s.feed_type === 'manual' && <span className="chip" style={{ marginLeft: 6 }}>manuel</span>}
                <div className="muted">
                  {s.matches < 0
                    ? 'Betingelserne er ugyldige — reglen kan ikke køre.'
                    : `${s.matches} produkter bidrager${s.max_products ? ` (loft ${s.max_products})` : ''}`}
                </div>
              </div>
              <form action={removeSource}>
                <input type="hidden" name="id" value={w.id} />
                <input type="hidden" name="source_id" value={s.id} />
                <button className="small danger">Fjern kilde</button>
              </form>
            </div>

            {s.matches === 0 && <p className="warn">Denne kilde bidrager med 0 produkter. Tjek betingelserne eller om feedet er hentet.</p>}
            {s.matches < 0 && <p className="bad">Ugyldige betingelser — ret dem nedenfor.</p>}

            <h2>Betingelser på dette feed</h2>
            <table>
              <thead><tr><th>Betingelse</th><th></th></tr></thead>
              <tbody>
                {conditions.length === 0 && <tr><td colSpan={2} className="muted">Ingen — hele feedet er med i puljen.</td></tr>}
                {conditions.map((c, i) => (
                  <tr key={i}>
                    <td>{describe(c)}</td>
                    <td>
                      <form action={removeCondition}>
                        <input type="hidden" name="id" value={w.id} />
                        <input type="hidden" name="source_id" value={s.id} />
                        <input type="hidden" name="idx" value={i} />
                        <button className="small ghost">Slet</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <form action={addCondition} className="row" style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={w.id} />
              <input type="hidden" name="source_id" value={s.id} />
              <label>Felt
                <select name="field">{RULE_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}</select>
              </label>
              <label>Operator
                <select name="operator">{RULE_OPERATORS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</select>
              </label>
              <label>Værdi<input name="value" placeholder="Vin > Rødvin" /></label>
              <button className="small">Tilføj betingelse</button>
            </form>

            <div className="row" style={{ marginTop: 10 }}>
              <form action={setSourceCap} className="row">
                <input type="hidden" name="id" value={w.id} />
                <input type="hidden" name="source_id" value={s.id} />
                <label>Maks. produkter fra denne kilde
                  <input name="max_products" type="number" min={1} defaultValue={s.max_products ?? ''} placeholder="uden loft" />
                </label>
                <button className="small ghost">Gem loft</button>
              </form>
            </div>

            <details style={{ marginTop: 10 }}>
              <summary className="muted">Avanceret: rediger betingelserne som JSON</summary>
              <form action={setConditionsJson} style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                <input type="hidden" name="id" value={w.id} />
                <input type="hidden" name="source_id" value={s.id} />
                <textarea name="conditions" defaultValue={s.conditions ? JSON.stringify(s.conditions, null, 2) : ''}
                          placeholder={'{ "any": [ { "field": "product_type", "operator": "contains", "value": "rødvin" } ] }'} />
                <button className="small ghost">Gem JSON</button>
              </form>
            </details>
          </div>
        );
      })}

      <h2>Tilføj kilde</h2>
      {feeds.length === 0 ? (
        <p className="warn">Ingen feeds endnu. Opret en <Link href="/advertisers">annoncør med et feed</Link> først.</p>
      ) : (
        <form className="panel" action={addSource}>
          <input type="hidden" name="id" value={w.id} />
          <label>Annoncørens feed
            <select name="feed_id" required>
              {feeds.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.advertiser} — {f.name} ({f.products} produkter{f.type === 'manual' ? ', manuel' : ''})
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <label>Navn på kilden (valgfrit)<input name="name" placeholder="Coop — rødvin" /></label>
            <label>Maks. produkter<input name="max_products" type="number" min={1} placeholder="uden loft" /></label>
          </div>
          <p className="muted" style={{ margin: 0 }}>
            Annoncøren følger feedet automatisk — en kilde kan aldrig komme til at kreditere en anden
            annoncør end den der ejer produkterne.
          </p>
          <button>Tilføj kilde</button>
        </form>
      )}

      {advertisers.length > 0 && (
        <>
          <h2>Annoncører i widgetten</h2>
          <table>
            <thead><tr><th>Annoncør</th><th>Kilder</th><th>Produkter</th><th>Pris</th></tr></thead>
            <tbody>
              {advertisers.map((a) => {
                const own = sources.filter((s) => s.advertiser_id === a.advertiser_id);
                return (
                  <tr key={a.advertiser_id}>
                    <td><Link href={`/advertisers/${a.advertiser_id}`}>{a.name}</Link></td>
                    <td>{own.length}</td>
                    <td>{own.reduce((n, s) => n + Math.max(0, s.matches), 0)}</td>
                    <td>{pricingLabel(a.pricing) || <span className="muted">ikke sat</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <div className="stepnav">
        <Link className="chip" href={`/widgets/${w.id}?step=type`}>← Type &amp; site</Link>
        <Link className="chip on" href={`/widgets/${w.id}?step=pricing`}>Monetisering →</Link>
      </div>
    </>
  );
}
