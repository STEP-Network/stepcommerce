// Feed ingestion (spec §4). Canonical schema = Google Shopping XML; generic
// XML maps in via feed.field_mapping; CSV supported minimally. The XML parser
// is SAX-based and streams — feeds can be 100k+ products.
import sax from 'sax';
import { createHash } from 'node:crypto';
import { query, sql } from './db';

export interface CanonicalProduct {
  external_id: string;
  title: string;
  description?: string;
  link: string;
  image_link?: string;
  additional_images: string[];
  price_amount?: string;
  price_currency?: string;
  sale_price_amount?: string;
  sale_price_currency?: string;
  availability?: string;
  brand?: string;
  gtin?: string;
  product_type?: string;
  google_product_category?: string;
  custom_label_0?: string;
  custom_label_1?: string;
  custom_label_2?: string;
  custom_label_3?: string;
  custom_label_4?: string;
  raw: Record<string, string>;
}

export interface FeedRow {
  id: string;
  source_url: string;
  type: 'google_shopping_xml' | 'generic_xml' | 'csv';
  field_mapping: Record<string, string> | null;
  last_fetch_hash: string | null;
  max_age_hours: number;
}

const CANONICAL_FIELDS = [
  'id', 'title', 'description', 'link', 'image_link', 'additional_image_link',
  'price', 'sale_price', 'availability', 'brand', 'gtin', 'product_type',
  'google_product_category', 'custom_label_0', 'custom_label_1', 'custom_label_2',
  'custom_label_3', 'custom_label_4',
];

function parsePrice(value?: string): { amount?: string; currency?: string } {
  if (!value) return {};
  const m = value.trim().match(/^([\d.,]+)\s*([A-Z]{3})?$/);
  if (!m) return {};
  // Google Shopping uses "89.95 DKK"; tolerate "89,95" as decimal comma.
  let amount = m[1];
  if (amount.includes(',') && !amount.includes('.')) amount = amount.replace(',', '.');
  else amount = amount.replace(/,(?=\d{3})/g, '');
  return { amount, currency: m[2] };
}

function toCanonical(fields: Record<string, string[]>): CanonicalProduct | null {
  const one = (k: string): string | undefined => fields[k]?.[0]?.trim() || undefined;
  const external_id = one('id');
  const title = one('title');
  const link = one('link');
  if (!external_id || !title || !link) return null;
  const price = parsePrice(one('price'));
  const sale = parsePrice(one('sale_price'));
  const raw: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) if (!CANONICAL_FIELDS.includes(k)) raw[k] = v.join(',');
  return {
    external_id,
    title,
    description: one('description'),
    link,
    image_link: one('image_link'),
    additional_images: (fields['additional_image_link'] ?? []).map((s) => s.trim()).filter(Boolean),
    price_amount: price.amount,
    price_currency: price.currency,
    sale_price_amount: sale.amount,
    sale_price_currency: sale.currency,
    availability: one('availability'),
    brand: one('brand'),
    gtin: one('gtin'),
    product_type: one('product_type'),
    google_product_category: one('google_product_category'),
    custom_label_0: one('custom_label_0'),
    custom_label_1: one('custom_label_1'),
    custom_label_2: one('custom_label_2'),
    custom_label_3: one('custom_label_3'),
    custom_label_4: one('custom_label_4'),
    raw,
  };
}

/**
 * Streams an XML feed through sax, invoking onProduct per parsed <item>/<entry>.
 * mapping (generic_xml): {source_tag: canonical_field}.
 */
export async function parseXmlFeed(
  body: ReadableStream<Uint8Array>,
  mapping: Record<string, string> | null,
  onProduct: (p: CanonicalProduct) => Promise<void>,
): Promise<{ count: number; hash: string }> {
  const parser = sax.parser(false, { lowercase: true, trim: false });
  const hash = createHash('sha256');
  let count = 0;
  let inItem = false;
  let fields: Record<string, string[]> = {};
  let currentTag: string | null = null;
  let text = '';
  const pending: CanonicalProduct[] = [];

  const normalizeTag = (tag: string): string => {
    const bare = tag.replace(/^g:/, '');
    return mapping?.[bare] ?? mapping?.[tag] ?? bare;
  };

  parser.onopentag = (node) => {
    const name = node.name;
    if (name === 'item' || name === 'entry') {
      inItem = true;
      fields = {};
    } else if (inItem) {
      currentTag = normalizeTag(name);
      text = '';
    }
  };
  parser.ontext = (t) => {
    if (currentTag) text += t;
  };
  parser.oncdata = (t) => {
    if (currentTag) text += t;
  };
  parser.onclosetag = (name) => {
    if (name === 'item' || name === 'entry') {
      inItem = false;
      const p = toCanonical(fields);
      if (p) {
        count++;
        pending.push(p);
      }
    } else if (inItem && currentTag) {
      (fields[currentTag] ??= []).push(text);
      currentTag = null;
    }
  };

  const decoder = new TextDecoder();
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    parser.write(decoder.decode(value, { stream: true }));
    while (pending.length) await onProduct(pending.shift()!);
  }
  parser.close();
  while (pending.length) await onProduct(pending.shift()!);
  return { count, hash: hash.digest('hex') };
}

/** Minimal CSV: first row = headers, comma-separated, double-quote escaping. */
export function parseCsv(textBody: string): Record<string, string[]>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < textBody.length; i++) {
    const ch = textBody[i];
    if (quoted) {
      if (ch === '"' && textBody[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
  const [headers, ...data] = rows.filter((r) => r.some((c) => c !== ''));
  if (!headers) return [];
  return data.map((r) => {
    const fields: Record<string, string[]> = {};
    headers.forEach((hd, i) => { if (r[i]) fields[hd.trim()] = [r[i]]; });
    return fields;
  });
}

const BATCH_SIZE = 200;

async function upsertBatch(feedId: string, batch: CanonicalProduct[]): Promise<void> {
  if (!batch.length) return;
  const cols = [
    'external_id', 'title', 'description', 'link', 'image_link', 'additional_images',
    'price_amount', 'price_currency', 'sale_price_amount', 'sale_price_currency',
    'availability', 'brand', 'gtin', 'product_type', 'google_product_category',
    'custom_label_0', 'custom_label_1', 'custom_label_2', 'custom_label_3', 'custom_label_4', 'raw',
  ] as const;
  const params: unknown[] = [feedId];
  const tuples = batch.map((p) => {
    const vals = cols.map((c) => {
      const v = c === 'additional_images' || c === 'raw' ? JSON.stringify(p[c]) : (p[c] ?? null);
      params.push(v);
      return `$${params.length}${c === 'additional_images' || c === 'raw' ? '::jsonb' : ''}`;
    });
    return `($1, ${vals.join(', ')}, true, now(), now())`;
  });
  await query(
    `insert into product (feed_id, ${cols.join(', ')}, available, last_seen_at, updated_at)
     values ${tuples.join(', ')}
     on conflict (feed_id, external_id) do update set
       ${cols.filter((c) => c !== 'external_id').map((c) => `${c} = excluded.${c}`).join(', ')},
       available = true, last_seen_at = now(), updated_at = now()`,
    params,
  );
}

export interface FetchResult {
  ok: boolean;
  status: 'healthy' | 'stale' | 'failing';
  count: number;
  dropped: number;
  error?: string;
}

/** Fetches one feed, upserts products, soft-deletes missing ones, updates health. */
export async function fetchFeed(feed: FeedRow): Promise<FetchResult> {
  const startedAt = new Date();
  const fail = async (error: string): Promise<FetchResult> => {
    await sql`
      update feed set status = 'failing',
        error_log = (coalesce(error_log, '[]'::jsonb) || ${JSON.stringify([{ ts: startedAt.toISOString(), error }])}::jsonb),
        updated_at = now()
      where id = ${feed.id}`;
    return { ok: false, status: 'failing', count: 0, dropped: 0, error };
  };

  const [{ prev_count }] = await query<{ prev_count: string }>(
    'select count(*)::text as prev_count from product where feed_id = $1 and available',
    [feed.id],
  );
  const previous = Number(prev_count);

  let res: Response;
  try {
    res = await fetch(feed.source_url, { headers: { 'user-agent': 'STEPCommerce-FeedFetcher/1.0' } });
  } catch (e) {
    return fail(`unreachable: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok || !res.body) return fail(`http_${res.status}`);

  let count = 0;
  let hash = '';
  let batch: CanonicalProduct[] = [];
  try {
    if (feed.type === 'csv') {
      const text = await res.text();
      hash = createHash('sha256').update(text).digest('hex');
      for (const fields of parseCsv(text)) {
        const mapped: Record<string, string[]> = {};
        for (const [k, v] of Object.entries(fields)) mapped[feed.field_mapping?.[k] ?? k] = v;
        const p = toCanonical(mapped);
        if (!p) continue;
        count++;
        batch.push(p);
        if (batch.length >= BATCH_SIZE) { await upsertBatch(feed.id, batch); batch = []; }
      }
    } else {
      const mapping = feed.type === 'generic_xml' ? feed.field_mapping : null;
      const result = await parseXmlFeed(res.body, mapping, async (p) => {
        batch.push(p);
        if (batch.length >= BATCH_SIZE) { await upsertBatch(feed.id, batch); batch = []; }
      });
      count = result.count;
      hash = result.hash;
    }
    await upsertBatch(feed.id, batch);
  } catch (e) {
    return fail(`parse_failure: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (count === 0) return fail('zero_products');
  const dropThreshold = 0.5;
  if (previous > 0 && count < previous * (1 - dropThreshold)) {
    return fail(`dropped_products: ${previous} -> ${count}`);
  }

  // Soft-delete products missing from this fetch.
  const dropped = (await query(
    'update product set available = false, updated_at = now() where feed_id = $1 and available and last_seen_at < $2 returning id',
    [feed.id, startedAt.toISOString()],
  )).length;

  // Unchanged content since last fetch is fine — freshness is last_fetch_at,
  // which we just proved; 'stale' is set by the health sweep when fetches stop.
  await sql`
    update feed set status = 'healthy', last_fetch_at = now(), last_fetch_hash = ${hash}, updated_at = now()
    where id = ${feed.id}`;
  return { ok: true, status: 'healthy', count, dropped };
}

/** Marks feeds whose last successful fetch is older than max_age_hours as stale. */
export async function sweepStaleFeeds(): Promise<number> {
  const rows = await query(
    `update feed set status = 'stale', updated_at = now()
     where status = 'healthy'
       and (last_fetch_at is null or last_fetch_at < now() - (max_age_hours || ' hours')::interval)
     returning id`,
  );
  return rows.length;
}
