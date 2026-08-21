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
  /** Non-Google XML feeds may wrap products in something other than <item>. */
  item_element?: string | null;
}

const CANONICAL_FIELDS = [
  'id', 'title', 'description', 'link', 'image_link', 'additional_image_link',
  'price', 'sale_price', 'availability', 'brand', 'gtin', 'product_type',
  'google_product_category', 'custom_label_0', 'custom_label_1', 'custom_label_2',
  'custom_label_3', 'custom_label_4',
];

/**
 * Google Shopping mandates "89.95 DKK", but Danish exports routinely emit
 * "1.289,00 DKK" (dot grouping, comma decimal) and "1.289 DKK". Getting this
 * wrong is not cosmetic: "1.289 DKK" naively parsed becomes 1.29, i.e. a wrong
 * price on a publisher page. The separator that appears LAST decides which role
 * each character plays; a group separator is only accepted when exactly three
 * digits follow it. Anything still unparseable yields no price rather than an
 * invalid numeric that would abort the whole feed.
 */
export function parsePrice(value?: string): { amount?: string; currency?: string } {
  if (!value) return {};
  const m = value.trim().match(/^([\d.,\s]+?)\s*([A-Z]{3})?$/);
  if (!m) return {};
  const raw = m[1].replace(/\s/g, '');
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  let amount: string;
  if (dec === -1) {
    amount = raw;
  } else if (raw.length - dec - 1 === 3 && (lastDot === -1 || lastComma === -1)) {
    amount = raw.replace(/[.,]/g, ''); // grouping only: 1.289 / 1,289
  } else {
    amount = raw.slice(0, dec).replace(/[.,]/g, '') + '.' + raw.slice(dec + 1);
  }
  if (!/^\d+(\.\d+)?$/.test(amount)) return {};
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
  itemTags: string[] = ['item', 'entry'],
): Promise<{ count: number; hash: string; complete: boolean }> {
  const parser = sax.parser(false, { lowercase: true, trim: false });
  const hash = createHash('sha256');
  let count = 0;
  let inItem = false;
  let depth = 0;
  let fields: Record<string, string[]> = {};
  let currentTag: string | null = null;
  let text = '';
  let sawRootClose = false;
  const pending: CanonicalProduct[] = [];
  const isItem = (name: string): boolean => itemTags.includes(name);

  const normalizeTag = (tag: string): string => {
    const bare = tag.replace(/^g:/, '');
    return mapping?.[bare] ?? mapping?.[tag] ?? bare;
  };

  // Depth tracking matters: Google Shopping items contain nested blocks such as
  // <g:shipping><g:price>49.00</g:price></g:shipping>. Without it, the shipping
  // price lands in the same `price` bucket as the product price and — depending
  // on element order — becomes the rendered price.
  parser.onopentag = (node) => {
    const name = node.name;
    if (isItem(name)) {
      inItem = true;
      depth = 0;
      fields = {};
      currentTag = null;
      return;
    }
    if (!inItem) return;
    depth++;
    if (depth === 1) {
      currentTag = normalizeTag(name);
      text = '';
    } else {
      currentTag = null; // nested element: not a canonical field
    }
  };
  parser.ontext = (t) => {
    if (currentTag) text += t;
  };
  parser.oncdata = (t) => {
    if (currentTag) text += t;
  };
  parser.onclosetag = (name) => {
    if (name === 'rss' || name === 'feed') sawRootClose = true;
    if (isItem(name)) {
      inItem = false;
      depth = 0;
      const p = toCanonical(fields);
      if (p) {
        count++;
        pending.push(p);
      }
      return;
    }
    if (!inItem) return;
    if (depth === 1 && currentTag) {
      (fields[currentTag] ??= []).push(text);
      currentTag = null;
    }
    depth--;
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
  parser.write(decoder.decode()); // flush a trailing partial multi-byte sequence
  parser.close();
  while (pending.length) await onProduct(pending.shift()!);
  return { count, hash: hash.digest('hex'), complete: sawRootClose };
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
const FETCH_TIMEOUT_MS = 60_000;

/**
 * Feed URLs are set by admins, but the fetcher runs with Vercel's egress, so
 * restrict it to public http(s) endpoints: no other schemes, no loopback,
 * link-local (cloud metadata) or private ranges.
 */
export function validateFeedUrl(raw: string): { ok: true } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `blocked_scheme: ${url.protocol}` };
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // Loopback is allowed outside production so the bundled demo feed can be
  // fetched from a local dev server.
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (loopback && process.env.NODE_ENV !== 'production') return { ok: true };
  if (
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') ||
    host === '::1' || host === '0.0.0.0' ||
    /^127\./.test(host) || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
    /^(100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.)/.test(host) ||
    /^f[cd][0-9a-f]{2}:/.test(host)
  ) {
    return { ok: false, reason: `blocked_host: ${host}` };
  }
  return { ok: true };
}

async function upsertBatch(feedId: string, rawBatch: CanonicalProduct[]): Promise<void> {
  if (!rawBatch.length) return;
  // ON CONFLICT DO UPDATE cannot touch the same row twice in one statement, so
  // a feed that repeats a g:id inside one batch (common in variant exports)
  // would abort the whole fetch and take the advertiser dark. Last one wins.
  const deduped = new Map<string, CanonicalProduct>();
  for (const p of rawBatch) deduped.set(p.external_id, p);
  const batch = [...deduped.values()];
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
  contentChanged?: boolean;
}

/** Fetches one feed, upserts products, soft-deletes missing ones, updates health. */
export async function fetchFeed(feed: FeedRow): Promise<FetchResult> {
  // The soft-delete watermark must come from the DATABASE clock, not the
  // function's: last_seen_at is stamped with now() server-side, so comparing it
  // against a Node timestamp that runs even slightly ahead soft-deletes rows
  // this very run just wrote — silently emptying the catalogue while the feed
  // still reports healthy.
  const [{ started_at: startedAt }] = await query<{ started_at: string }>('select now() as started_at');
  const fail = async (error: string): Promise<FetchResult> => {
    await sql`
      update feed set status = 'failing',
        error_log = (coalesce(error_log, '[]'::jsonb) || ${JSON.stringify([{ ts: new Date().toISOString(), error }])}::jsonb),
        updated_at = now()
      where id = ${feed.id}`;
    return { ok: false, status: 'failing', count: 0, dropped: 0, error };
  };

  const [{ prev_count }] = await query<{ prev_count: string }>(
    'select count(*)::text as prev_count from product where feed_id = $1 and available',
    [feed.id],
  );
  const previous = Number(prev_count);

  const urlCheck = validateFeedUrl(feed.source_url);
  if (!urlCheck.ok) return fail(urlCheck.reason);

  let res: Response;
  try {
    // Hard timeout: without it one slow advertiser origin can trickle bytes
    // until the 300s function budget is gone, so the remaining feeds are never
    // fetched, go stale, and stop rendering.
    res = await fetch(feed.source_url, {
      headers: { 'user-agent': 'STEPCommerce-FeedFetcher/1.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
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
      const itemTag = feed.item_element?.trim();
      const result = await parseXmlFeed(
        res.body,
        mapping,
        async (p) => {
          batch.push(p);
          if (batch.length >= BATCH_SIZE) { await upsertBatch(feed.id, batch); batch = []; }
        },
        itemTag ? [itemTag.toLowerCase()] : undefined,
      );
      count = result.count;
      hash = result.hash;
      // A truncated download is not a parse error in non-strict SAX mode: it
      // just yields fewer products, which the drop check may wave through and
      // the soft-delete then turns into a silently emptied catalogue.
      if (!result.complete) return fail('truncated_feed: root close tag never seen');
    }
    await upsertBatch(feed.id, batch);
  } catch (e) {
    return fail(`parse_failure: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (count === 0) return fail('zero_products');
  // A price feed losing a tenth of its catalogue is already suspicious; 50% was
  // far too permissive for the legal posture here.
  const dropThreshold = 0.15;
  if (previous > 0 && count < previous * (1 - dropThreshold)) {
    return fail(`dropped_products: ${previous} -> ${count}`);
  }

  // Soft-delete products missing from this fetch.
  const dropped = (await query(
    'update product set available = false, updated_at = now() where feed_id = $1 and available and last_seen_at < $2 returning id',
    [feed.id, startedAt],
  )).length;

  // Content-hash comparison (spec §4.4). last_fetch_at only proves we
  // downloaded something; it says nothing about whether the ADVERTISER updated
  // it. A feed frozen behind a CDN keeps returning HTTP 200 forever, so without
  // this we would happily render month-old prices with a green feed status.
  // content_changed_at is what the staleness sweep actually judges.
  const changed = hash !== feed.last_fetch_hash;
  await sql`
    update feed set status = 'healthy', last_fetch_at = now(), last_fetch_hash = ${hash},
      content_changed_at = case when ${changed} then now() else coalesce(content_changed_at, now()) end,
      updated_at = now()
    where id = ${feed.id}`;
  return { ok: true, status: 'healthy', count, dropped, contentChanged: changed };
}

/**
 * Marks a feed stale when either its last successful fetch OR its last actual
 * content change is older than max_age_hours.
 */
export async function sweepStaleFeeds(): Promise<number> {
  const rows = await query(
    `update feed set status = 'stale', updated_at = now()
     where status = 'healthy'
       and (last_fetch_at is null
            or last_fetch_at < now() - (max_age_hours || ' hours')::interval
            or coalesce(content_changed_at, last_fetch_at) < now() - (max_age_hours || ' hours')::interval)
     returning id`,
  );
  return rows.length;
}
