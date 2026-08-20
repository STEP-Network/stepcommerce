import Link from 'next/link';
import { revalidatePath } from 'next/cache';
import { query, sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Instances() {
  async function create(formData: FormData) {
    'use server';
    const templateId = String(formData.get('template_id') ?? '');
    const siteId = String(formData.get('site_id') ?? '');
    const advertiserId = String(formData.get('advertiser_id') ?? '');
    const feedId = String(formData.get('feed_id') ?? '');
    const name = String(formData.get('name') ?? '').trim();
    const rate = String(formData.get('rate') ?? '').trim();
    if (!templateId || !siteId || !advertiserId || !name) return;
    const rows = (await sql`
      insert into widget_instance (template_id, site_id, name)
      values (${templateId}, ${siteId}, ${name}) returning id`) as { id: string }[];
    await sql`
      insert into instance_advertiser (instance_id, advertiser_id, product_source, pricing_model, rate)
      values (${rows[0].id}, ${advertiserId},
              ${JSON.stringify({ kind: 'full_feed', feed_id: feedId || null })},
              'fixed', ${rate ? Number(rate) : null})`;
    revalidatePath('/instances');
  }

  async function duplicate(formData: FormData) {
    'use server';
    // Duplicate-and-remap in one click (spec §11): copy with cleared site
    // binding + mappings; the copy starts as draft on the same site until remapped.
    const iid = String(formData.get('id') ?? '');
    const rows = (await sql`
      insert into widget_instance (template_id, site_id, name, size_config, token_overrides, fallback_config, status)
      select template_id, site_id, name || ' (kopi)', size_config, token_overrides, fallback_config, 'draft'
      from widget_instance where id = ${iid} returning id`) as { id: string }[];
    await sql`
      insert into instance_advertiser (instance_id, advertiser_id, product_source, pricing_model, rate, priority)
      select ${rows[0].id}, advertiser_id, product_source, pricing_model, rate, priority
      from instance_advertiser where instance_id = ${iid}`;
    revalidatePath('/instances');
  }

  const rows = await query<{ id: string; name: string; status: string; template: string; site: string; advertiser: string; mappings: string }>(
    `select wi.id, wi.name, wi.status, wt.name as template, s.domain as site, a.name as advertiser,
            (select count(*) from kv_mapping m where m.instance_id = wi.id)::text as mappings
     from widget_instance wi
     join widget_template wt on wt.id = wi.template_id
     join site s on s.id = wi.site_id
     join instance_advertiser ia on ia.instance_id = wi.id
     join advertiser a on a.id = ia.advertiser_id
     order by wi.created_at desc`,
  );
  const [templates, sites, advertisers, feeds] = await Promise.all([
    query<{ id: string; name: string }>('select id, name from widget_template order by name'),
    query<{ id: string; domain: string }>('select id, domain from site order by domain'),
    query<{ id: string; name: string }>('select id, name from advertiser order by name'),
    query<{ id: string; name: string }>('select id, name from feed order by name'),
  ]);

  return (
    <>
      <h1>Widget-instanser</h1>
      <table>
        <thead><tr><th>Navn</th><th>Status</th><th>Template</th><th>Site</th><th>Advertiser</th><th>Mappings</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/instances/${r.id}`}>{r.name}</Link></td>
              <td><span className={`status ${r.status}`}>{r.status}</span></td>
              <td>{r.template}</td><td>{r.site}</td><td>{r.advertiser}</td><td>{r.mappings}</td>
              <td>
                <form action={duplicate}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="small">Duplikér</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Opret instans (V1: exclusive — én advertiser)</h2>
      <form className="panel" action={create}>
        <label>Navn<input name="name" required /></label>
        <label>Template<select name="template_id">{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label>Site<select name="site_id">{sites.map((s) => <option key={s.id} value={s.id}>{s.domain}</option>)}</select></label>
        <label>Advertiser<select name="advertiser_id">{advertisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label>Feed (default produktkilde)<select name="feed_id"><option value="">—</option>{feeds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label>Talt CPC-rate (kr., rapporteres men faktureres ikke i V1)<input name="rate" type="number" step="0.01" /></label>
        <button>Opret</button>
      </form>
    </>
  );
}
