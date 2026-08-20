// GET /c/{product_id}?i={instance}&pl={placement} (spec §8): the first-party
// click redirect. Logs the canonical click, then 302s to the product link.
// The destination is always looked up server-side — never taken from the URL —
// so this cannot be used as an open redirect.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const placementId = req.nextUrl.searchParams.get('pl')?.match(UUID)?.[0] ?? null;
  const ua = req.headers.get('user-agent') ?? '';
  const quality: string[] = [];
  if (/bot|crawler|spider|headless/i.test(ua)) quality.push('bot_ua');

  try {
    const clicks = await query<{ id: string }>(
      'insert into click (product_id, instance_id, placement_id, destination, redeemed_at) values ($1, $2, $3, $4, now()) returning id',
      [row.id, row.instance_id, placementId, row.link],
    );
    await query(
      `insert into event (type, placement_id, instance_id, advertiser_id, product_id, site_id, click_id, quality_flags)
       values ('click', $1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [placementId, row.instance_id, row.advertiser_id, row.id, row.site_id, clicks[0]?.id ?? null, JSON.stringify(quality)],
    );
  } catch {
    // Never lose the user on a logging failure — redirect anyway.
  }
  return NextResponse.redirect(row.link, 302);
}
