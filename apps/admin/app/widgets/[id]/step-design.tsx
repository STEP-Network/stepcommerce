// Step 5 — design. AI-first: describe the widget (and optionally point at the
// page it will live on), and Fable 5 turns it into design tokens. "Manuelt
// design" reveals the full visual editor and the code view. The preview on the
// right is the real widget runtime resolving the real placement.
import Link from 'next/link';
import { query } from '@/lib/db';
import { basePathUrl } from '@/lib/base-path';
import { assetUrl } from '@/lib/assets';
import { LAYOUTS, META_FIELDS, TOKEN_FIELDS, type Widget } from '@/lib/wizard';
import type { DesignTokens } from '@/lib/serve-types';
import { applyTemplate, runAiStyle, saveAsTemplate, saveDesign, saveDesignCode } from './actions';

/** A key-value string that exercises the widget: first known value per key. */
function sampleKv(w: Widget): string {
  const keys = w.kv_taxonomy?.keys ?? [];
  const parts = keys
    .filter((k) => (k.values ?? []).length > 0)
    .slice(0, 4)
    .map((k) => `${k.key}=${k.values![0]}`);
  return parts.length ? parts.join(';') : 'mv_page=artikel';
}

export default async function StepDesign({
  w,
  sp,
}: {
  w: Widget;
  sp: { editor?: string; kv?: string; device?: string };
}) {
  const tokens = (w.design_tokens ?? {}) as DesignTokens & Record<string, unknown>;
  const meta = (w.token_overrides?.__meta ?? {}) as Record<string, string>;
  const ai = (w.token_overrides as Record<string, unknown>)?.__ai as
    | { rationale?: string; palette?: string[]; fonts?: string[]; url?: string; prompt?: string; notes?: string[] }
    | undefined;
  const shot = (w.token_overrides as Record<string, unknown>)?.__shot as string | undefined;
  const manual = sp.editor === 'manual' || sp.editor === 'code';
  const codeView = sp.editor === 'code';
  const kv = sp.kv ?? sampleKv(w);
  const device = sp.device ?? 'desktop';
  const layouts = LAYOUTS.filter((l) => (l.types as readonly string[]).includes(w.widget_type));
  const native = w.widget_type === 'takeover';

  const templates = await query<{ id: string; name: string; layout_type: string }>(
    `select id, name, layout_type from widget_template
     where coalesce((meta->>'library')::boolean, false) = true
       and (widget_type is null or widget_type = $1)
     order by updated_at desc limit 30`,
    [w.widget_type],
  );

  const frameUrl = w.placement_code
    ? basePathUrl(`/api/preview-frame?placement=${encodeURIComponent(w.placement_code)}&kv=${encodeURIComponent(kv)}&device=${encodeURIComponent(device)}`)
    : null;
  const frameWidth = device === 'mobile' ? 390 : device === 'tablet' ? 768 : 980;
  const base = `/widgets/${w.id}?step=design`;

  return (
    <div className="cols sticky-right">
      <div>
        <div className="chipset" style={{ marginBottom: 14 }}>
          <Link className={`chip ${manual ? '' : 'on'}`} href={base}>✨ AI-design</Link>
          <Link className={`chip ${manual && !codeView ? 'on' : ''}`} href={`${base}&editor=manual`}>Manuelt design</Link>
          <Link className={`chip ${codeView ? 'on' : ''}`} href={`${base}&editor=code`}>Kode</Link>
        </div>

        {!manual && (
          <>
            <form className="card" action={runAiStyle} style={{ display: 'grid', gap: 12 }} encType="multipart/form-data">
              <input type="hidden" name="id" value={w.id} />
              <label>
                Beskriv designet — hvad skal widgetten udstråle?
                <textarea name="prompt" style={{ minHeight: 110, fontFamily: 'inherit', fontSize: 13 }}
                          defaultValue={ai?.prompt ?? ''}
                          placeholder={native
                            ? 'En native brandflade for Harald Nyborg i forum-stil: navy og gul, tilbudsavis-følelse, tydelig men venlig CTA "Se ugens avis".'
                            : 'Tre vinkort der ligner Madens Verdens egne opskriftssektioner: varm hvid baggrund, serif-overskrifter, bordeaux accenter, diskrete priser, rund CTA.'} />
              </label>
              <details>
                <summary className="muted">Giv AI&apos;en mere at gå efter: side-URL og screenshot (valgfrit)</summary>
                <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                  <label>URL på en side hvor widgetten skal stå
                    <input name="page_url" type="url" defaultValue={ai?.url ?? ''} placeholder={`https://${w.domain}/`} />
                  </label>
                  <label>Screenshot af området<input name="screenshot" type="file" accept="image/*" /></label>
                  <label>Hvor på siden? (fritekst)
                    <input name="area_note" placeholder="Midt i artiklen, efter ingredienslisten — smal spalte, hvid baggrund" />
                  </label>
                </div>
              </details>
              <label className="check"><input type="checkbox" name="apply_layout" defaultChecked /> Lad AI&apos;en også vælge layout</label>
              <button>✨ Generér design</button>
              <p className="muted" style={{ margin: 0 }}>
                Genereres med Claude Fable 5. Angiver du en URL, læser vi sidens rigtige CSS (farver, fonte,
                radius); et screenshot fortæller den hvordan området omkring widgetten ser ud.
              </p>
            </form>

            {ai?.rationale && (
              <div className="card" style={{ marginTop: 14 }}>
                <b>Seneste generering</b>
                <p style={{ marginTop: 6 }}>{ai.rationale}</p>
                {ai.palette?.length ? (
                  <div className="chipset" style={{ marginTop: 10 }}>
                    {ai.palette.map((c) => (
                      <span className="chip" key={c} style={{ background: c, color: '#fff', border: '1px solid #d8d3ec' }}>{c}</span>
                    ))}
                  </div>
                ) : null}
                {ai.fonts?.length ? <p className="muted" style={{ marginTop: 8 }}>Fonte: {ai.fonts.join(', ')}</p> : null}
                {ai.notes?.length ? <p className="muted">{ai.notes.join(' ')}</p> : null}
                {shot && <img src={assetUrl(shot)} alt="" style={{ maxWidth: '100%', marginTop: 10, borderRadius: 10, border: '1px solid #e7e3f4' }} />}
                <p className="muted" style={{ marginTop: 10 }}>
                  Ikke helt i mål? Justér prompten og generér igen — eller finpuds under{' '}
                  <Link href={`${base}&editor=manual`}>Manuelt design</Link>.
                </p>
              </div>
            )}

            <h2>Tekster på widgetten</h2>
            <form className="card" action={saveDesign} style={{ display: 'grid', gap: 10 }}>
              <input type="hidden" name="id" value={w.id} />
              <input type="hidden" name="layout" value={w.layout_type} />
              <input type="hidden" name="slots" value={w.slot_count?.default ?? 3} />
              <input type="hidden" name="custom_css" value={tokens.customCss ?? ''} />
              {(native
                ? META_FIELDS
                : META_FIELDS.filter((m) => !['heroText', 'ctaUrl'].includes(m.key))
              ).map((m) => (
                <label key={m.key}>{m.label}<input name={`m_${m.key}`} defaultValue={meta[m.key] ?? ''} placeholder={m.placeholder} /></label>
              ))}
              {TOKEN_FIELDS.filter((f) => f.type === 'color').map((f) => {
                const v = (tokens as Record<string, unknown>)[f.key];
                return v ? <input key={f.key} type="hidden" name={`t_${f.key}`} value={String(v)} /> : null;
              })}
              {TOKEN_FIELDS.filter((f) => f.type === 'color').map((f) =>
                (tokens as Record<string, unknown>)[f.key]
                  ? <input key={`u${f.key}`} type="hidden" name={`use_${f.key}`} value="on" />
                  : null,
              )}
              {TOKEN_FIELDS.filter((f) => f.type !== 'color').map((f) => {
                const v = (tokens as Record<string, unknown>)[f.key];
                return v !== undefined && v !== null
                  ? <input key={f.key} type="hidden" name={`t_${f.key}`} value={String(v)} />
                  : null;
              })}
              <button className="small">Gem tekster</button>
            </form>
          </>
        )}

        {manual && !codeView && (
          <form className="card" action={saveDesign} style={{ display: 'grid', gap: 14 }}>
            <input type="hidden" name="id" value={w.id} />
            <input type="hidden" name="custom_css" value={tokens.customCss ?? ''} />
            <div className="optcards">
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Layout</span>
              {layouts.map((l) => (
                <label className="opt" key={l.id}>
                  <input type="radio" name="layout" value={l.id} defaultChecked={w.layout_type === l.id} />
                  <span>{l.label}<div className="opt-hint">{l.hint}</div></span>
                </label>
              ))}
            </div>
            <label>Antal produktpladser<input name="slots" type="number" min={1} max={12} defaultValue={w.slot_count?.default ?? 3} /></label>

            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Farver og form</span>
            <div className="pgrid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {TOKEN_FIELDS.map((f) => {
                const current = (tokens as Record<string, unknown>)[f.key];
                const value = current === undefined || current === null ? '' : String(current);
                return (
                  <label key={f.key} style={{ fontSize: 11 }}>
                    {f.label}
                    {f.type === 'color' ? (
                      <input type="color" name={`t_${f.key}`}
                             defaultValue={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'} />
                    ) : f.type === 'select' ? (
                      <select name={`t_${f.key}`} defaultValue={value}>
                        <option value="">—</option>
                        {(f as { options?: readonly string[] }).options?.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input name={`t_${f.key}`} type={f.type === 'number' ? 'number' : 'text'} defaultValue={value} />
                    )}
                    {f.type === 'color' && (
                      <span className="muted" style={{ fontWeight: 400 }}>
                        <label className="check" style={{ fontSize: 10 }}>
                          <input type="checkbox" name={`use_${f.key}`} defaultChecked={value !== ''} /> brug denne farve
                        </label>
                      </span>
                    )}
                  </label>
                );
              })}
            </div>

            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '.07em' }}>Tekster</span>
            {META_FIELDS.map((m) => (
              <label key={m.key}>{m.label}<input name={`m_${m.key}`} defaultValue={meta[m.key] ?? ''} placeholder={m.placeholder} /></label>
            ))}

            <button>Gem design</button>
          </form>
        )}

        {codeView && (
          <form className="card" action={saveDesignCode} style={{ display: 'grid', gap: 10 }}>
            <input type="hidden" name="id" value={w.id} />
            <label>
              Design-tokens (JSON)
              <textarea name="tokens_json" style={{ minHeight: 300 }}
                        defaultValue={JSON.stringify(Object.fromEntries(Object.entries(tokens).filter(([k]) => k !== 'customCss')), null, 2)} />
            </label>
            <label>
              Egen CSS (indsættes i widgettens shadow root)
              <textarea name="custom_css" style={{ minHeight: 140 }} defaultValue={tokens.customCss ?? ''}
                        placeholder={'.sc-card { letter-spacing: .01em }'} />
            </label>
            <p className="muted" style={{ margin: 0 }}>
              Værdier saniteres før de rammer stylesheetet, og annonce-mærkningens størrelse, vægt og
              opacitet kan ikke overskrives — det er et lovkrav, ikke en designbeslutning.
            </p>
            <button>Gem kode</button>
          </form>
        )}

        <h2>Skabeloner</h2>
        <div className="card" style={{ display: 'grid', gap: 12 }}>
          <form action={saveAsTemplate} className="row">
            <input type="hidden" name="id" value={w.id} />
            <label>Gem dette design som skabelon<input name="template_name" placeholder={`${w.name} (skabelon)`} /></label>
            <button className="small ghost">Gem som skabelon</button>
          </form>
          {templates.length > 0 && (
            <form action={applyTemplate} className="row">
              <input type="hidden" name="id" value={w.id} />
              <label>Start fra en gemt skabelon
                <select name="template_id">
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.layout_type})</option>)}
                </select>
              </label>
              <button className="small ghost">Anvend</button>
            </form>
          )}
          <p className="muted" style={{ margin: 0 }}>
            En skabelon er en kopi af et design vi allerede har bygget. Anvender du en, kopieres den ind i
            denne widget — senere ændringer her rører ikke andre widgets.
          </p>
        </div>

        <div className="stepnav">
          <Link className="chip" href={`/widgets/${w.id}?step=pricing`}>← Monetisering</Link>
          <Link className="chip on" href={`/widgets/${w.id}?step=targeting`}>Targeting →</Link>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Live preview</h2>
        {!frameUrl ? (
          <p className="warn">Intet placement — preview kræver en embed-kode.</p>
        ) : (
          <>
            <form className="row" style={{ marginBottom: 10 }} action={basePathUrl(`/widgets/${w.id}`)} method="get">
              <input type="hidden" name="step" value="design" />
              {sp.editor && <input type="hidden" name="editor" value={sp.editor} />}
              <label style={{ flex: '2 1 200px' }}>Sidens key-values<input name="kv" defaultValue={kv} /></label>
              <label>Enhed
                <select name="device" defaultValue={device}>
                  <option value="desktop">desktop</option><option value="tablet">tablet</option><option value="mobile">mobil</option>
                </select>
              </label>
              <button className="small ghost">Opdatér</button>
            </form>
            <iframe className="frame" src={frameUrl} style={{ width: frameWidth, maxWidth: '100%', height: 620 }} title="preview" />
            <p className="muted" style={{ marginTop: 8 }}>
              Preview kører også på draft og bruger de rigtige feed-data. Renderer den ikke, står årsagen i{' '}
              <Link href="/health">Health</Link>.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
