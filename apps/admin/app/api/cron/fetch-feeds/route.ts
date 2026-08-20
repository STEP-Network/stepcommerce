// Vercel cron (hourly): fetch all active feeds, then sweep stale ones so
// widgets bound to dead feeds stop rendering (spec §4).
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { fetchFeed, sweepStaleFeeds, type FeedRow } from '@/lib/feed';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const feeds = await query<FeedRow & { name: string }>(
    `select id, name, source_url, type, field_mapping, last_fetch_hash, max_age_hours
     from feed
     where source_url not like '%example.invalid%'`,
  );
  const results: Record<string, unknown> = {};
  for (const feed of feeds) {
    results[feed.name] = await fetchFeed(feed);
  }
  const stale = await sweepStaleFeeds();
  return NextResponse.json({ ok: true, fetched: feeds.length, stale, results });
}
