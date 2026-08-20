import { revalidatePath } from 'next/cache';
import { query, sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

const LAYOUTS = ['recipe_section', 'forum_post', 'carousel', 'grid', 'stacked', 'single_card'];

export default async function Templates() {
  async function create(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    const layout = String(formData.get('layout_type') ?? '');
    const tokens = String(formData.get('design_tokens') ?? '{}');
    const slots = Number(formData.get('slot_count') ?? 3);
    if (!name || !LAYOUTS.includes(layout)) return;
    await sql`
      insert into widget_template (name, layout_type, design_tokens, slot_count)
      values (${name}, ${layout}, ${JSON.stringify(JSON.parse(tokens))}, ${JSON.stringify({ default: slots })})`;
    revalidatePath('/templates');
  }

  async function updateTokens(formData: FormData) {
    'use server';
    const tid = String(formData.get('id') ?? '');
    const tokens = String(formData.get('design_tokens') ?? '{}');
    await sql`update widget_template set design_tokens = ${JSON.stringify(JSON.parse(tokens))}, updated_at = now() where id = ${tid}`;
    revalidatePath('/templates');
  }

  const rows = await query<{ id: string; name: string; layout_type: string; design_tokens: Record<string, unknown>; slot_count: { default?: number }; instances: string }>(
    `select t.id, t.name, t.layout_type, t.design_tokens, t.slot_count,
            (select count(*) from widget_instance wi where wi.template_id = t.id)::text as instances
     from widget_template t order by t.created_at`,
  );

  return (
    <>
      <h1>Widget-templates</h1>
      <p className="muted">
        Design-tokens er stylingkontrakten (spec §6). Restyler du en template, opdateres alle instanser,
        medmindre instansen overrider. Live preview: brug widget-playgrounden med tokens fra feltet herunder.
      </p>
      {rows.map((t) => (
        <div key={t.id}>
          <h2>{t.name} · <code>{t.layout_type}</code> · {t.slot_count?.default ?? 3} slots · {t.instances} instanser</h2>
          <form className="panel" action={updateTokens}>
            <input type="hidden" name="id" value={t.id} />
            <label>Design-tokens (JSON)
              <textarea name="design_tokens" defaultValue={JSON.stringify(t.design_tokens, null, 2)} />
            </label>
            <button className="small">Gem tokens</button>
          </form>
        </div>
      ))}

      <h2>Opret template</h2>
      <form className="panel" action={create}>
        <label>Navn<input name="name" required /></label>
        <label>Layout
          <select name="layout_type">{LAYOUTS.map((l) => <option key={l}>{l}</option>)}</select>
        </label>
        <label>Antal produkt-slots<input name="slot_count" type="number" defaultValue={3} min={1} max={12} /></label>
        <label>Design-tokens (JSON)<textarea name="design_tokens" defaultValue={'{\n  "colorAccent": "#5F46D2"\n}'} /></label>
        <button>Opret</button>
      </form>
    </>
  );
}
