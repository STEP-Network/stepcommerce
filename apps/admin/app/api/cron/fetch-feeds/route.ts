// Vercel cron (hourly): fetch all active feeds, then sweep stale ones so
// widgets bound to dead feeds stop rendering (spec §4).
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { fetchFeed, sweepStaleFeeds, type FeedRow } from '@/lib/feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Fail closed: an unset CRON_SECRET in production would expose a 300s
  // function that refetches every feed and rewrites the product table.
  const secret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === 'production' && !secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const feeds = await query<FeedRow & { name: string }>(
    `select id, name, source_url, type, field_mapping, last_fetch_hash, max_age_hours, item_element
     from feed
     where source_url not like '%example.invalid%'`,
  );
  const results: Record<string, unknown> = {};
  for (const feed of feeds) {
    // One bad feed must not abort the loop — the feeds after it would never be
    // fetched and would eventually go stale and stop rendering.
    let result: Record<string, unknown>;
    try {
      result = await fetchFeed(feed) as unknown as Record<string, unknown>;
    } catch (e) {
      result = { ok: false, status: 'failing', error: e instanceof Error ? e.message : 'unknown' };
    }
    results[feed.name] = result;
    // Log every attempt so feed uptime (spec §13: >= 99%) is computable and an
    // overnight breakage is visible in the morning.
    try {
      await query(
        `insert into feed_fetch_log (feed_id, ok, status, products, dropped, content_changed, error)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          feed.id,
          result.ok === true,
          String(result.status ?? 'unknown'),
          Number(result.count ?? 0),
          Number(result.dropped ?? 0),
          result.contentChanged ?? null,
          result.error ? String(result.error).slice(0, 500) : null,
        ],
      );
    } catch {
      /* logging must not break the run */
    }
  }
  const stale = await sweepStaleFeeds();
  return NextResponse.json({ ok: true, fetched: feeds.length, stale, results });
}
