// Template library. A template here is a saved copy of a design we already
// built in the wizard — not a hand-authored record. That is the only way one
// gets created: "Gem som skabelon" in a widget's design step.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';
import { LAYOUTS } from '@/lib/wizard';
import type { DesignTokens } from '@/lib/serve-types';

export const dynamic = 'force-dynamic';

export default async function Templates() {
  async function rename(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    if (!name) return;
    await query(
      `update widget_template set name = $2, updated_at = now()
       where id = $1 and coalesce((meta->>'library')::boolean, false) = true`,
      [String(formData.get('tid') ?? ''), name],
    );
    revalidatePath('/templates');
  }

  async function remove(formData: FormData) {
    'use server';
    // Only unused library templates: a template still backing a widget must not
    // vanish under it.
    await query(
      `delete from widget_template wt
       where wt.id = $1 and coalesce((wt.meta->>'library')::boolean, false) = true
         and not exists (select 1 from widget_instance wi where wi.template_id = wt.id)`,
      [String(formData.get('tid') ?? '')],
    );
    revalidatePath('/templates');
  }

  const templates = await query<{
    id: string; name: string; layout_type: string; widget_type: string | null;
    design_tokens: DesignTokens; slot_count: { default?: number }; from_widget: string | null; used: string; updated: string;
  }>(
    `select wt.id, wt.name, wt.layout_type, wt.widget_type, wt.design_tokens, wt.slot_count,
            wi.name as from_widget,
            (select count(*) from widget_instance w2 where w2.template_id = wt.id)::text as used,
            to_char(wt.updated_at, 'YYYY-MM-DD HH24:MI') as updated
     from widget_template wt
     left join widget_instance wi on wi.id = wt.created_from_instance_id
     where coalesce((wt.meta->>'library')::boolean, false) = true
     order by wt.updated_at desc`,
  );

  return (
    <>
      <h1>Skabeloner</h1>
      <p className="muted">
        Skabeloner er gemte kopier af designs vi har bygget. Du opretter dem i en widgets design-trin
        (&quot;Gem som skabelon&quot;) og bruger dem som startpunkt for nye widgets.
      </p>

      {templates.length === 0 ? (
        <p className="hint">
          Ingen skabeloner endnu. Byg en widget færdig i <Link href="/widgets">Widgets</Link> og gem designet
          som skabelon, når det sidder.
        </p>
      ) : (
        templates.map((t) => {
          const colors = Object.entries(t.design_tokens ?? {})
            .filter(([k, v]) => k.startsWith('color') && typeof v === 'string')
            .slice(0, 8) as [string, string][];
          return (
            <div className="card" key={t.id} style={{ marginBottom: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <b>{t.name}</b>
                  <div className="muted">
                    {LAYOUTS.find((l) => l.id === t.layout_type)?.label ?? t.layout_type} ·{' '}
                    {t.slot_count?.default ?? 3} pladser ·{' '}
                    {t.widget_type === 'takeover' ? 'takeover' : 'produkt-matching'} · opdateret {t.updated}
                    {t.from_widget ? ` · fra "${t.from_widget}"` : ''}
                    {Number(t.used) > 0 ? ` · bruges af ${t.used} widget(s)` : ''}
                  </div>
                </div>
                <div className="chipset">
                  {colors.map(([k, v]) => (
                    <span className="chip" key={k} title={k} style={{ background: v, color: '#fff', border: '1px solid #d8d3ec' }}>{v}</span>
                  ))}
                </div>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <form action={rename} className="row">
                  <input type="hidden" name="tid" value={t.id} />
                  <label>Navn<input name="name" defaultValue={t.name} /></label>
                  <button className="small ghost">Gem navn</button>
                </form>
                {Number(t.used) === 0 && (
                  <form action={remove}>
                    <input type="hidden" name="tid" value={t.id} />
                    <button className="small danger">Slet</button>
                  </form>
                )}
              </div>
            </div>
          );
        })
      )}
    </>
  );
}
