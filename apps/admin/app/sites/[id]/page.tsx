// Site detail: the key-value taxonomy the wizard targets against, plus the
// per-site term dictionaries used for dict-matching on multi-value keys.
import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface KvKey { key: string; label?: string; values?: string[]; multi?: boolean }

/** Values are pasted by hand — one per line or comma separated. */
function parseValues(raw: string): string[] {
  return [...new Set(raw.split(/[\n,;]/).map((v) => v.trim()).filter(Boolean))];
}

export default async function SiteDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  async function saveSite(formData: FormData) {
    'use server';
    await query(
      `update site set publisher = coalesce(nullif($2, ''), publisher), contact = nullif($3, ''),
              notes = nullif($4, ''), updated_at = now() where id = $1`,
      [id, String(formData.get('publisher') ?? '').trim(), String(formData.get('contact') ?? '').trim(), String(formData.get('notes') ?? '').trim()],
    );
    revalidatePath(`/sites/${id}`);
  }

  async function saveKey(formData: FormData) {
    'use server';
    const key = String(formData.get('key') ?? '').trim();
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) return;
    const entry: KvKey = {
      key,
      label: String(formData.get('label') ?? '').trim() || undefined,
      values: parseValues(String(formData.get('values') ?? '')),
      multi: formData.get('multi') === 'on' || undefined,
    };
    const rows = await query<{ kv_taxonomy: { keys?: KvKey[] } | null }>('select kv_taxonomy from site where id = $1', [id]);
    const keys = (rows[0]?.kv_taxonomy?.keys ?? []).filter((k) => k.key !== key);
    keys.push(entry);
    keys.sort((a, b) => a.key.localeCompare(b.key));
    await query(`update site set kv_taxonomy = $2::jsonb, updated_at = now() where id = $1`, [id, JSON.stringify({ keys })]);
    revalidatePath(`/sites/${id}`);
  }

  async function removeKey(formData: FormData) {
    'use server';
    const key = String(formData.get('key') ?? '');
    const rows = await query<{ kv_taxonomy: { keys?: KvKey[] } | null }>('select kv_taxonomy from site where id = $1', [id]);
    const keys = (rows[0]?.kv_taxonomy?.keys ?? []).filter((k) => k.key !== key);
    await query(`update site set kv_taxonomy = $2::jsonb, updated_at = now() where id = $1`, [id, JSON.stringify({ keys })]);
    revalidatePath(`/sites/${id}`);
  }

  async function saveDict(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    const bulk = String(formData.get('entries') ?? '');
    if (!name) return;
    const entries: Record<string, string> = {};
    for (const line of bulk.split('\n')) {
      const [term, segment] = line.split(/[\t;]/).map((s) => s?.trim());
      if (term && segment) entries[term.toLowerCase()] = segment;
    }
    const existing = String(formData.get('dict_id') ?? '');
    if (existing) {
      await query(`update kv_dictionary set name = $2, entries = $3::jsonb, updated_at = now() where id = $1 and site_id = $4`,
        [existing, name, JSON.stringify(entries), id]);
    } else {
      await query(`insert into kv_dictionary (site_id, name, entries) values ($1, $2, $3::jsonb)`,
        [id, name, JSON.stringify(entries)]);
    }
    revalidatePath(`/sites/${id}`);
  }

  const sites = await query<{
    id: string; publisher: string; domain: string; contact: string | null; notes: string | null;
    kv_taxonomy: { keys?: KvKey[] } | null;
  }>('select id, publisher, domain, contact, notes, kv_taxonomy from site where id = $1', [id]);
  const site = sites[0];
  if (!site) return <h1>Site ikke fundet</h1>;
  const keys = site.kv_taxonomy?.keys ?? [];

  const dicts = await query<{ id: string; name: string; entries: Record<string, string> }>(
    'select id, name, entries from kv_dictionary where site_id = $1 order by name',
    [id],
  );
  // Which keys the site has actually SENT recently. Hand-maintained taxonomies
  // drift; this is the reality check.
  const seen = await query<{ k: string; n: string }>(
    `select k as k, count(*)::text as n
     from event e, jsonb_object_keys(e.kv_context) k
     where e.site_id = $1 and e.ts > now() - interval '7 days'
     group by 1 order by count(*) desc limit 30`,
    [id],
  );
  const declared = new Set(keys.map((k) => k.key));
  const undeclared = seen.filter((s) => !declared.has(s.k) && s.k !== 'limited_ads');

  return (
    <>
      <h1>{site.domain}</h1>
      <p className="muted"><Link href="/sites">← Alle sites</Link> · {site.publisher}{site.contact ? ` · ${site.contact}` : ''}</p>

      <h2>Key-values siden kan sende</h2>
      <p className="hint">
        Widget-wizarden viser præcis disse nøgler og værdier, når du bygger targeting. Værdierne indtastes
        manuelt — vi kan ikke gætte dem ud af publisher&apos;ens CMS. Marker en nøgle som multi-value, hvis
        den sender flere værdier i samme streng (fx <code>mv_ingredients</code>); den skal matches med ordbog.
      </p>
      <table>
        <thead><tr><th>Key</th><th>Label</th><th>Kendte værdier</th><th>Multi</th><th></th></tr></thead>
        <tbody>
          {keys.length === 0 && <tr><td colSpan={5} className="muted">Ingen keys endnu.</td></tr>}
          {keys.map((k) => (
            <tr key={k.key}>
              <td><code>{k.key}</code></td>
              <td>{k.label ?? '—'}</td>
              <td><span className="chipset">{(k.values ?? []).map((v) => <span className="chip" key={v}>{v}</span>)}</span>
                  {(k.values ?? []).length === 0 && <span className="muted">fri tekst</span>}</td>
              <td>{k.multi ? 'ja' : '—'}</td>
              <td>
                <form action={removeKey}><input type="hidden" name="key" value={k.key} /><button className="small danger">Slet</button></form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {undeclared.length > 0 && (
        <p className="warn">
          Siden har sendt disse nøgler de sidste 7 dage uden at de står i taksonomien:{' '}
          {undeclared.map((u) => `${u.k} (${u.n})`).join(', ')}. Tilføj dem, hvis du vil targete på dem.
        </p>
      )}

      <h2>Tilføj / opdatér key</h2>
      <form className="panel" action={saveKey}>
        <div className="row">
          <label>Key<input name="key" required placeholder="mv_cat" pattern="[A-Za-z0-9_]{1,40}" /></label>
          <label>Label<input name="label" placeholder="Artikelkategori" /></label>
        </div>
        <label>Kendte værdier (én pr. linje eller kommasepareret — lad stå tom for fri tekst)
          <textarea name="values" placeholder={'aftensmad\nfrokost\nbagning'} />
        </label>
        <label className="check"><input type="checkbox" name="multi" /> Multi-value (flere værdier i samme streng — kræver ordbogsmatch)</label>
        <button>Gem key</button>
      </form>

      <h2>Ordbøger (term → segment)</h2>
      <p className="muted">
        Bruges til multi-value keys: ordbogen oversætter sidens termer til et segment, som targeting kan
        matche på. Matchet er ord-ankret, så &quot;and&quot; matcher ikke &quot;vand&quot;.
      </p>
      {dicts.map((d) => (
        <form className="panel" action={saveDict} key={d.id} style={{ marginBottom: 12, maxWidth: 760 }}>
          <input type="hidden" name="dict_id" value={d.id} />
          <label>Navn<input name="name" defaultValue={d.name} required /></label>
          <label>{Object.keys(d.entries).length} termer (term;segment — én pr. linje)
            <textarea name="entries" defaultValue={Object.entries(d.entries).map(([t, s]) => `${t};${s}`).join('\n')} style={{ minHeight: 160 }} />
          </label>
          <button className="small">Gem ordbog</button>
        </form>
      ))}

      <h2>Ny ordbog</h2>
      <form className="panel" action={saveDict}>
        <label>Navn<input name="name" required placeholder="Ingredienser → pairing-segment" /></label>
        <label>Term → segment (én pr. linje, adskilt med semikolon eller tab)
          <textarea name="entries" placeholder={'skinkeschnitzler;svinekød\nkylling;fjerkræ\nlaks;fisk'} />
        </label>
        <button>Opret ordbog</button>
      </form>

      <h2>Site-indstillinger</h2>
      <form className="panel" action={saveSite}>
        <label>Publisher<input name="publisher" defaultValue={site.publisher} /></label>
        <label>Kontakt<input name="contact" defaultValue={site.contact ?? ''} /></label>
        <label>Noter<textarea name="notes" defaultValue={site.notes ?? ''} style={{ minHeight: 60 }} /></label>
        <button>Gem</button>
      </form>
    </>
  );
}
