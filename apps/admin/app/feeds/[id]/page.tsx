// Feed detail: health, fetch-now, product browser, and the product-rule
// builder with live preview of matching products (spec §11).
import { revalidatePath } from 'next/cache';
import { query, sql } from '@/lib/db';
import { fetchFeed, type FeedRow } from '@/lib/feed';
import { compileRule, type RuleConditions } from '@/lib/rules';

export const dynamic = 'force-dynamic';

export default async function FeedDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ preview_rule?: string }>;
}) {
  const { id } = await params;
  const { preview_rule } = await searchParams;

  async function fetchNow() {
    'use server';
    const rows = await query<FeedRow>(
      'select id, source_url, type, field_mapping, last_fetch_hash, max_age_hours from feed where id = $1',
      [id],
    );
    if (rows[0]) await fetchFeed(rows[0]);
    revalidatePath(`/feeds/${id}`);
  }

  async function createRule(formData: FormData) {
    'use server';
    const name = String(formData.get('name') ?? '').trim();
    const conditions = String(formData.get('conditions') ?? '');
    if (!name || !conditions) return;
    const parsed = JSON.parse(conditions) as RuleConditions;
    compileRule(parsed); // validate fields/operators before saving
    await sql`insert into product_rule (feed_id, name, conditions) values (${id}, ${name}, ${JSON.stringify(parsed)})`;
    revalidatePath(`/feeds/${id}`);
  }

  async function setMapping(formData: FormData) {
    'use server';
    const mapping = String(formData.get('field_mapping') ?? '').trim();
    await sql`update feed set field_mapping = ${mapping ? JSON.stringify(JSON.parse(mapping)) : null}, updated_at = now() where id = ${id}`;
    revalidatePath(`/feeds/${id}`);
  }

  const feeds = await query<{
    id: string; name: string; advertiser: string; type: string; status: string; source_url: string;
    last_fetch_at: string | null; max_age_hours: number; error_log: { ts: string; error: string }[];
    field_mapping: Record<string, string> | null; products: string;
  }>(
    `select f.id, f.name, a.name as advertiser, f.type, f.status, f.source_url,
            to_char(f.last_fetch_at, 'YYYY-MM-DD HH24:MI') as last_fetch_at,
            f.max_age_hours, f.error_log, f.field_mapping,
            (select count(*) from product p where p.feed_id = f.id and p.available)::text as products
     from feed f join advertiser a on a.id = f.advertiser_id where f.id = $1`,
    [id],
  );
  const feed = feeds[0];
  if (!feed) return <h1>Feed ikke fundet</h1>;

  const rules = await query<{ id: string; name: string; conditions: RuleConditions }>(
    'select id, name, conditions from product_rule where feed_id = $1 order by created_at',
    [id],
  );

  let previewRows: { title: string; price_amount: string | null; availability: string | null }[] = [];
  let previewError: string | null = null;
  const previewRule = rules.find((r) => r.id === preview_rule);
  if (previewRule) {
    try {
      const compiled = compileRule(previewRule.conditions, 1);
      previewRows = await query(
        `select title, price_amount::text, availability from product
         where feed_id = $1 and available and (${compiled.where}) limit 12`,
        [id, ...compiled.params],
      );
    } catch (e) {
      previewError = e instanceof Error ? e.message : String(e);
    }
  }

  const products = await query<{ external_id: string; title: string; price_amount: string | null; availability: string | null; custom_label_0: string | null }>(
    'select external_id, title, price_amount::text, availability, custom_label_0 from product where feed_id = $1 and available order by updated_at desc limit 25',
    [id],
  );

  return (
    <>
      <h1>{feed.name} <span className={`status ${feed.status}`}>{feed.status}</span></h1>
      <p className="muted">
        {feed.advertiser} · <code>{feed.type}</code> · {feed.products} produkter · sidste fetch: {feed.last_fetch_at ?? 'aldrig'} ·
        max alder {feed.max_age_hours} t · <a href={feed.source_url}>kilde</a>
      </p>
      <form action={fetchNow} style={{ margin: '12px 0' }}><button>Hent feed nu</button></form>

      {feed.error_log?.length > 0 && (
        <>
          <h2>Seneste fejl</h2>
          <pre><code>{feed.error_log.slice(-5).map((e) => `${e.ts}  ${e.error}`).join('\n')}</code></pre>
        </>
      )}

      {feed.type !== 'google_shopping_xml' && (
        <>
          <h2>Field mapping (kilde-felt → kanonisk felt)</h2>
          <form className="panel" action={setMapping}>
            <label>JSON
              <textarea name="field_mapping" defaultValue={feed.field_mapping ? JSON.stringify(feed.field_mapping, null, 2) : '{\n  "produktnavn": "title"\n}'} />
            </label>
            <button>Gem mapping</button>
          </form>
        </>
      )}

      <h2>Produktregler</h2>
      <table>
        <thead><tr><th>Navn</th><th>Betingelser</th><th></th></tr></thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id}>
              <td>{r.name}<div className="muted"><code>{r.id}</code></div></td>
              <td><code>{JSON.stringify(r.conditions)}</code></td>
              <td><a href={`?preview_rule=${r.id}`}>Preview</a></td>
            </tr>
          ))}
        </tbody>
      </table>

      {previewRule && (
        <>
          <h2>Preview: {previewRule.name}</h2>
          {previewError ? (
            <pre><code>{previewError}</code></pre>
          ) : (
            <table>
              <thead><tr><th>Titel</th><th>Pris</th><th>Lager</th></tr></thead>
              <tbody>
                {previewRows.length === 0 && <tr><td colSpan={3} className="muted">Ingen produkter matcher.</td></tr>}
                {previewRows.map((p, i) => <tr key={i}><td>{p.title}</td><td>{p.price_amount ?? '—'}</td><td>{p.availability ?? '—'}</td></tr>)}
              </tbody>
            </table>
          )}
        </>
      )}

      <h2>Ny produktregel</h2>
      <form className="panel" action={createRule}>
        <label>Navn<input name="name" required /></label>
        <label>Betingelser (JSON — operatorer: equals, contains, in, gt, lt, exists)
          <textarea name="conditions" defaultValue={'{\n  "all": [\n    { "field": "custom_label_0", "operator": "equals", "value": "ugens_tilbud" },\n    { "field": "availability", "operator": "equals", "value": "in stock" }\n  ]\n}'} />
        </label>
        <button>Opret regel</button>
      </form>

      <h2>Produkter (seneste 25)</h2>
      <table>
        <thead><tr><th>ID</th><th>Titel</th><th>Pris</th><th>Lager</th><th>custom_label_0</th></tr></thead>
        <tbody>
          {products.map((p) => (
            <tr key={p.external_id}>
              <td><code>{p.external_id}</code></td><td>{p.title}</td>
              <td>{p.price_amount ?? '—'}</td><td>{p.availability ?? '—'}</td><td>{p.custom_label_0 ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
