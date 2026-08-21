// Step 3 — the products. Only the chosen advertisers' feeds appear here. Each
// source is one feed plus its own conditions and cap, so one wine widget can
// carry 10 products from Coop, 100 from Salling and 2 hand-made from Dagrofa.
// Products can also be created by hand right here — or skipped entirely, which
// turns the widget into a pure native ad (the LDS forum-post example).
import Link from 'next/link';
import { query } from '@/lib/db';
import { RULE_FIELDS, RULE_OPERATORS, type RuleNode } from '@/lib/rules';
import { assetUrl } from '@/lib/assets';
import type { AdvertiserSummary, SourceSummary, Widget } from '@/lib/wizard';
import {
  addCondition, addSource, createManualProduct, removeCondition, removeSource,
  setConditionsJson, setSourceCap, skipProducts,
} from './actions';

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
  const advertiserIds = advertisers.map((a) => a.advertiser_id);
  const feeds = advertiserIds.length
    ? await query<{ id: string; name: string; type: string; status: string; advertiser: string; advertiser_id: string; products: string }>(
        `select f.id, f.name, f.type, f.status, a.name as advertiser, a.id as advertiser_id,
                (select count(*) from product p where p.feed_id = f.id and p.available)::text as products
         from feed f join advertiser a on a.id = f.advertiser_id
         where f.advertiser_id = any($1)
         order by a.name, f.type = 'manual', f.name`,
        [advertiserIds],
      )
    : [];
  const slots = w.slot_count?.default ?? 3;
  const pool = sources.reduce((n, s) => n + Math.max(0, s.matches), 0);
  const takeover = w.widget_type === 'takeover';

  if (advertisers.length === 0) {
    return (
      <>
        <p className="warn">
          Vælg mindst én <Link href={`/widgets/${w.id}?step=advertisers`}>annoncør</Link> først —
          produkterne kommer fra deres feeds.
        </p>
        <div className="stepnav">
          <Link className="chip" href={`/widgets/${w.id}?step=advertisers`}>← Annoncører</Link>
        </div>
      </>
    );
  }

  return (
    <>
      {takeover ? (
        <p className="hint">
          Widgetten kører som <b>native annonce uden produktkrav</b>. Du kan stadig tilføje kilder — så vises
          produkterne oveni brandfladen.
        </p>
      ) : (
        <div className="card" style={{ display: 'flex', gap: 16, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <b>Skal widgetten overhovedet vise produkter?</b>
            <div className="muted">
              Uden produkter bliver den en ren native annonce — som Harald Nyborg-eksemplet på lav-det-selv.dk —
              med tekst, brandflade og CTA, som du designer i trin 5.
            </div>
          </div>
          <form action={skipProducts}>
            <input type="hidden" name="id" value={w.id} />
            <button className="ghost">Spring produkter over →</button>
          </form>
        </div>
      )}

      {feedIssues.demo && <p className="bad">En kilde peger på demo-feedet. Skift til annoncørens rigtige feed før du går live.</p>}
      {feedIssues.unhealthy.length > 0 && (
        <p className="bad">Ikke-healthy feeds: {feedIssues.unhealthy.join(', ')}. Stale data må aldrig renderes.</p>
      )}

      <h2>Produktkilder ({sources.length}) · samlet pulje {pool} produkter · {slots} pladser i widgetten</h2>
      {sources.length === 0 && !takeover && (
        <p className="muted">Ingen kilder endnu — tilføj et feed nedenfor, eller opret et produkt manuelt.</p>
      )}

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
              <tbody>
                {conditions.length === 0 && <tr><td className="muted">Ingen betingelser — hele feedet er med i puljen.</td><td /></tr>}
                {conditions.map((c, i) => (
                  <tr key={i}>
                    <td>{describe(c)}</td>
                    <td style={{ textAlign: 'right' }}>
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

            <form action={addCondition} className="row" style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={w.id} />
              <input type="hidden" name="source_id" value={s.id} />
              <label>Felt
                <select name="field">{RULE_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}</select>
              </label>
              <label>Operator
                <select name="operator">{RULE_OPERATORS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</select>
              </label>
              <label>Værdi<input name="value" placeholder="Vin &gt; Rødvin" /></label>
              <button className="small">Tilføj betingelse</button>
            </form>

            <form action={setSourceCap} className="row" style={{ marginTop: 10 }}>
              <input type="hidden" name="id" value={w.id} />
              <input type="hidden" name="source_id" value={s.id} />
              <label>Maks. produkter fra denne kilde
                <input name="max_products" type="number" min={1} defaultValue={s.max_products ?? ''} placeholder="uden loft" />
              </label>
              <button className="small ghost">Gem loft</button>
            </form>

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

      <div className="cols">
        <div>
          <h2>Tilføj feed som kilde</h2>
          {feeds.length === 0 ? (
            <p className="warn">
              De valgte annoncører har ingen feeds. Tilføj et feed på{' '}
              {advertisers.map((a, i) => (
                <span key={a.advertiser_id}>{i > 0 && ', '}<Link href={`/advertisers/${a.advertiser_id}`}>{a.name}</Link></span>
              ))} — eller opret produkter manuelt til højre.
            </p>
          ) : (
            <form className="panel" action={addSource} style={{ maxWidth: 'none' }}>
              <input type="hidden" name="id" value={w.id} />
              <label>Feed (kun de valgte annoncørers)
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
              <button>Tilføj kilde</button>
            </form>
          )}
        </div>

        <div>
          <h2>Opret produkt manuelt</h2>
          <form className="panel" action={createManualProduct} style={{ maxWidth: 'none' }} encType="multipart/form-data">
            <input type="hidden" name="id" value={w.id} />
            <label>Annoncør
              <select name="advertiser_id" required>
                {advertisers.map((a) => <option key={a.advertiser_id} value={a.advertiser_id}>{a.name}</option>)}
              </select>
            </label>
            <label>Titel<input name="title" required placeholder="Amarone della Valpolicella 2019" /></label>
            <label>Beskrivelse<textarea name="description" style={{ minHeight: 56 }} /></label>
            <div className="row">
              <label>Pris (DKK)<input name="price" placeholder="249" /></label>
              <label>Brand<input name="brand" placeholder="Zenato" /></label>
              <label>Kategori<input name="product_type" placeholder="Vin &gt; Rødvin" /></label>
            </div>
            <label>Billede (upload)<input name="image" type="file" accept="image/*" /></label>
            <label>… eller billed-URL<input name="image_link" type="url" placeholder="https://…" /></label>
            <label>Produkt-URL (landingsside)<input name="link" type="url" required placeholder="https://…" /></label>
            <label>Affiliate-URL (bruges som klik-destination hvis udfyldt)<input name="affiliate_url" type="url" placeholder="https://track.adtraction.com/t/t?a=…" /></label>
            <p className="muted" style={{ margin: 0 }}>
              Produktet lægges i annoncørens manuelle katalog og ryger direkte i widgettens pulje. Pris og
              lager er dit ansvar — der er intet feed at tjekke imod.
            </p>
            <button>Opret produkt</button>
          </form>
        </div>
      </div>

      <div className="stepnav">
        <Link className="chip" href={`/widgets/${w.id}?step=advertisers`}>← Annoncører</Link>
        <Link className="chip on" href={`/widgets/${w.id}?step=pricing`}>Monetisering →</Link>
      </div>
    </>
  );
}
