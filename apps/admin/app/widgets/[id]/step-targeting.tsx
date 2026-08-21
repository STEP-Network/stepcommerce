// Step 5 — targeting. "If the page says X, then show Y" in the site's own
// key-values. Rules are evaluated top-down and the FIRST match decides, so the
// order is part of the configuration, not cosmetics.
import Link from 'next/link';
import { query } from '@/lib/db';
import { RULE_FIELDS, RULE_OPERATORS } from '@/lib/rules';
import type { SourceSummary, TargetingRule, Widget } from '@/lib/wizard';
import ProductBrowser, { type BrowserParams } from '@/app/_components/product-browser';
import { addTargeting, moveTargeting, pickProduct, removeTargeting, saveFallback } from './actions';

function describeTarget(t: TargetingRule['target'], ruleNames: Map<string, string>): string {
  switch (t?.kind) {
    case 'hide': return 'Vis IKKE widgetten';
    case 'all': return 'Vis hele puljen';
    case 'rule': return `Brug produktreglen "${ruleNames.get(t.rule_id ?? '') ?? t.rule_id}"`;
    case 'explicit': return `Vis ${(t.product_ids ?? []).length} udvalgte produkter`;
    case 'filter': {
      const list = (t.conditions as { all?: { field?: string; operator?: string; value?: unknown }[] })?.all ?? [];
      return 'Filtrér puljen: ' + list.map((c) => {
        const label = RULE_FIELDS.find((f) => f.field === c.field)?.label ?? c.field;
        const op = RULE_OPERATORS.find((o) => o.op === c.operator)?.label ?? c.operator;
        const v = Array.isArray(c.value) ? c.value.join(', ') : String(c.value ?? '');
        return `${label} ${op} "${v}"`;
      }).join(' og ');
    }
    default: return JSON.stringify(t);
  }
}

export default async function StepTargeting({
  w,
  sources,
  targeting,
  sp,
}: {
  w: Widget;
  sources: SourceSummary[];
  targeting: TargetingRule[];
  sp: BrowserParams & { pick?: string };
}) {
  const feedIds = [...new Set(sources.map((s) => s.feed_id))];
  const [dicts, rules] = await Promise.all([
    query<{ id: string; name: string; segments: string[] }>(
      `select d.id, d.name,
              coalesce((select array_agg(distinct v) from jsonb_each_text(d.entries) as e(k, v)), '{}') as segments
       from kv_dictionary d where d.site_id = $1 order by d.name`,
      [w.site_id],
    ),
    feedIds.length
      ? query<{ id: string; name: string; feed: string }>(
          `select pr.id, pr.name, f.name as feed from product_rule pr join feed f on f.id = pr.feed_id
           where pr.feed_id = any($1) order by f.name, pr.name`,
          [feedIds],
        )
      : Promise.resolve([]),
  ]);
  const ruleNames = new Map(rules.map((r) => [r.id, r.name]));
  const keys = w.kv_taxonomy?.keys ?? [];
  const picking = sp.pick ? targeting.find((t) => t.id === sp.pick) : undefined;
  const picked = new Set(picking?.target?.product_ids ?? []);
  const fallback = w.fallback_config?.strategy === 'default_products'
    ? ((w.fallback_config.target as { kind?: string })?.kind === 'rule' ? 'rule' : 'all')
    : 'hide';

  return (
    <>
      <p className="hint">
        Reglerne læses ovenfra og ned, og den <b>første</b> der matcher bestemmer. Matcher ingen regel, falder
        widgetten tilbage på indstillingen nederst — som standard viser den ikke noget, netop fordi en
        halvfærdig widget aldrig må ende med at vise hele kataloget.
      </p>
      {keys.length === 0 && (
        <p className="warn">
          Sitet <b>{w.domain}</b> har ingen keys i taksonomien. Du kan stadig skrive en key i hånden, men{' '}
          <Link href={`/sites/${w.site_id}`}>tilføj dem på sitet</Link> så alle kan se hvad der findes.
        </p>
      )}

      <h2>Regler ({targeting.length})</h2>
      <table>
        <thead><tr><th>#</th><th>Hvis siden siger</th><th>Så</th><th>Rækkefølge</th><th></th></tr></thead>
        <tbody>
          {targeting.length === 0 && <tr><td colSpan={5} className="muted">Ingen regler endnu.</td></tr>}
          {targeting.map((t, i) => (
            <tr key={t.id}>
              <td>{i + 1}</td>
              <td>
                <code>{t.page_key}</code>{' '}
                {t.operator === 'dict'
                  ? <>matcher ordbogen <b>{t.dict_name}</b> → segment <b>{t.segment}</b></>
                  : <>{t.operator === 'eq' ? 'er' : 'indeholder'} <b>{t.page_value}</b></>}
              </td>
              <td>
                {describeTarget(t.target, ruleNames)}
                {t.target?.kind === 'explicit' && (
                  <div><Link href={`/widgets/${w.id}?step=targeting&pick=${t.id}`}>Vælg produkter →</Link></div>
                )}
              </td>
              <td>
                <div className="row" style={{ gap: 4 }}>
                  <form action={moveTargeting}>
                    <input type="hidden" name="id" value={w.id} /><input type="hidden" name="mapping_id" value={t.id} />
                    <input type="hidden" name="dir" value="up" /><button className="small ghost" disabled={i === 0}>↑</button>
                  </form>
                  <form action={moveTargeting}>
                    <input type="hidden" name="id" value={w.id} /><input type="hidden" name="mapping_id" value={t.id} />
                    <input type="hidden" name="dir" value="down" /><button className="small ghost" disabled={i === targeting.length - 1}>↓</button>
                  </form>
                </div>
              </td>
              <td>
                <form action={removeTargeting}>
                  <input type="hidden" name="id" value={w.id} /><input type="hidden" name="mapping_id" value={t.id} />
                  <button className="small danger">Slet</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {picking && (
        <>
          <h2>Vælg produkter til regel: {picking.page_key} {picking.page_value ?? picking.segment}</h2>
          <p className="muted">{picked.size} valgt. Produkterne kommer fra widgettens egne kilder.</p>
          <ProductBrowser
            feedIds={feedIds}
            urlBase={`/widgets/${w.id}`}
            params={{ ...sp, step: 'targeting', pick: picking.id } as BrowserParams}
            feeds={[...new Map(sources.map((s) => [s.feed_id, { id: s.feed_id, name: `${s.advertiser} — ${s.feed}` }])).values()]}
            action={(p) => (
              <form action={pickProduct}>
                <input type="hidden" name="id" value={w.id} />
                <input type="hidden" name="mapping_id" value={picking.id} />
                <input type="hidden" name="product_id" value={p.id} />
                <input type="hidden" name="op" value={picked.has(p.id) ? 'remove' : 'add'} />
                <button className={`small ${picked.has(p.id) ? 'danger' : 'ghost'}`}>
                  {picked.has(p.id) ? 'Fjern' : 'Tilføj'}
                </button>
              </form>
            )}
          />
          <p style={{ marginTop: 12 }}><Link href={`/widgets/${w.id}?step=targeting`}>← Tilbage til reglerne</Link></p>
        </>
      )}

      <h2>Tilføj regel</h2>
      <form className="panel" action={addTargeting} style={{ maxWidth: 'none' }}>
        <input type="hidden" name="id" value={w.id} />
        <div className="row">
          <label>Key
            {keys.length ? (
              <select name="page_key" required>
                {keys.map((k) => <option key={k.key} value={k.key}>{k.key}{k.label ? ` — ${k.label}` : ''}</option>)}
              </select>
            ) : <input name="page_key" required placeholder="mv_cat" />}
          </label>
          <label>Sådan matches den
            <select name="operator" defaultValue="eq">
              <option value="eq">er lig med</option>
              <option value="contains">indeholder</option>
              <option value="dict">matcher ordbog (multi-value keys)</option>
            </select>
          </label>
          <label>Værdi (eq/contains)
            <input name="page_value_free" list="kv-values" placeholder="aftensmad" />
            <datalist id="kv-values">
              {keys.flatMap((k) => (k.values ?? []).map((v) => <option key={`${k.key}-${v}`} value={v} />))}
            </datalist>
          </label>
        </div>
        <div className="row">
          <label>Ordbog (kun ved ordbogsmatch)
            <select name="dict_id"><option value="">—</option>{dicts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </label>
          <label>Segment
            <input name="segment" list="segments" placeholder="svinekød" />
            <datalist id="segments">
              {dicts.flatMap((d) => d.segments.map((s) => <option key={`${d.id}-${s}`} value={s} />))}
            </datalist>
          </label>
        </div>

        <fieldset style={{ border: 0, display: 'grid', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#3d3568' }}>Så skal widgetten…</span>
          <label className="check"><input type="radio" name="action" value="filter" defaultChecked /> Vise produkter der matcher et filter</label>
          <div className="row" style={{ paddingLeft: 24 }}>
            <label>Felt<select name="filter_field">{RULE_FIELDS.map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}</select></label>
            <label>Operator<select name="filter_operator">{RULE_OPERATORS.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}</select></label>
            <label>Værdi<input name="filter_value" placeholder="rødvin" /></label>
          </div>
          {rules.length > 0 && (
            <>
              <label className="check"><input type="radio" name="action" value="rule" /> Bruge en gemt produktregel</label>
              <div style={{ paddingLeft: 24 }}>
                <label>Regel<select name="rule_id"><option value="">—</option>{rules.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.feed})</option>)}</select></label>
              </div>
            </>
          )}
          <label className="check"><input type="radio" name="action" value="explicit" /> Vise bestemte produkter jeg vælger i hånden</label>
          <label className="check"><input type="radio" name="action" value="all" /> Vise hele puljen (ren vis/vis-ikke-regel)</label>
          <label className="check"><input type="radio" name="action" value="hide" /> IKKE vise widgetten</label>
        </fieldset>
        <button>Tilføj regel</button>
      </form>

      <h2>Når ingen regel matcher</h2>
      <form className="panel" action={saveFallback}>
        <input type="hidden" name="id" value={w.id} />
        <label className="check"><input type="radio" name="fallback" value="hide" defaultChecked={fallback === 'hide'} /> Vis ikke noget (anbefalet)</label>
        <label className="check"><input type="radio" name="fallback" value="all" defaultChecked={fallback === 'all'} /> Vis hele puljen</label>
        {rules.length > 0 && (
          <>
            <label className="check"><input type="radio" name="fallback" value="rule" defaultChecked={fallback === 'rule'} /> Vis et fast default-sæt fra en produktregel</label>
            <label style={{ paddingLeft: 24 }}>Regel
              <select name="rule_id"><option value="">—</option>{rules.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.feed})</option>)}</select>
            </label>
          </>
        )}
        <p className="muted" style={{ margin: 0 }}>
          Widgetten må aldrig hævde et kontekst-match den ikke har lavet: uden regelmatch skjules match-linje
          og chips automatisk, også når du viser et default-sæt.
        </p>
        <button>Gem fallback</button>
      </form>

      <div className="stepnav">
        <Link className="chip" href={`/widgets/${w.id}?step=design`}>← Design</Link>
        <Link className="chip on" href={`/widgets/${w.id}?step=launch`}>Embed &amp; live →</Link>
      </div>
    </>
  );
}
