// GET /c/{product_id}?i={instance}&pl={placement}&d={device} (spec §8): the
// first-party click redirect. Logs the canonical click, then 302s to the
// product link. The destination is always looked up server-side — never taken
// from the URL — so this cannot be used as an open redirect.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE = new Set(['desktop', 'tablet', 'mobile', 'unknown']);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
): Promise<NextResponse> {
  const { productId } = await params;
  if (!UUID.test(productId)) return new NextResponse('not found', { status: 404 });

  const rows = await query<{ id: string; link: string; feed_id: string; instance_id: string | null; advertiser_id: string | null; site_id: string | null }>(
    `select p.id, p.link, p.feed_id,
            wi.id as instance_id, ia.advertiser_id, wi.site_id
     from product p
     left join widget_instance wi on wi.id = $2
     left join instance_advertiser ia on ia.instance_id = wi.id
     where p.id = $1`,
    [productId, req.nextUrl.searchParams.get('i')?.match(UUID)?.[0] ?? null],
  );
  const row = rows[0];
  if (!row) return new NextResponse('not found', { status: 404 });

  // The destination comes from advertiser feed XML, so it is untrusted: reject
  // anything that is not an absolute http(s) URL rather than letting
  // NextResponse.redirect throw (which would 500 after the click was logged)
  // or letting a feed launder an exotic scheme through our first-party domain.
  let destination: URL;
  try {
    destination = new URL(row.link);
  } catch {
    return new NextResponse('not found', { status: 404 });
  }
  if (destination.protocol !== 'https:' && destination.protocol !== 'http:') {
    return new NextResponse('not found', { status: 404 });
  }

  const placementId = req.nextUrl.searchParams.get('pl')?.match(UUID)?.[0] ?? null;
  const deviceParam = req.nextUrl.searchParams.get('d') ?? '';
  // Device class must match what the beacons report, or clicks and impressions
  // land in different stats_hourly rows and every per-row CTR reads as zero.
  const deviceClass = DEVICE.has(deviceParam) ? deviceParam : 'unknown';
  const ua = req.headers.get('user-agent') ?? '';
  const quality: string[] = [];
  if (/bot|crawler|spider|headless/i.test(ua)) quality.push('bot_ua');

  // The click row is a convenience record; the event row is the billing-grade
  // log. Keep them in separate try/catch blocks so a failure to write one
  // never silently discards the other.
  let clickId: string | null = null;
  try {
    const clicks = await query<{ id: string }>(
      'insert into click (product_id, instance_id, placement_id, destination, redeemed_at) values ($1, $2, $3, $4, now()) returning id',
      [row.id, row.instance_id, placementId, destination.toString()],
    );
    clickId = clicks[0]?.id ?? null;
  } catch {
    // fall through — still log the event and redirect
  }
  try {
    await query(
      `insert into event (type, placement_id, instance_id, advertiser_id, product_id, site_id, click_id, device_class, quality_flags)
       values ('click', $1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [placementId, row.instance_id, row.advertiser_id, row.id, row.site_id, clickId, deviceClass, JSON.stringify(quality)],
    );
  } catch {
    // Never lose the user on a logging failure — redirect anyway.
  }
  return NextResponse.redirect(destination.toString(), 302);
}
