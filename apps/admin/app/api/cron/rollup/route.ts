// Vercel cron (hourly, :10): aggregates raw events into stats_hourly for
// dashboard speed (spec §3). Re-rolls the last 3 hours so late beacons land.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const ZERO = '00000000-0000-0000-0000-000000000000';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET;
  if (process.env.NODE_ENV === 'production' && !secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 });
  }
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const rows = await query(
    `insert into stats_hourly (hour, placement_id, instance_id, advertiser_id, site_id, device_class,
                               loads, viewables, product_impressions, clicks)
     select date_trunc('hour', ts),
            coalesce(placement_id, $1::uuid), coalesce(instance_id, $1::uuid),
            coalesce(advertiser_id, $1::uuid), coalesce(site_id, $1::uuid),
            coalesce(device_class, 'unknown'),
            count(*) filter (where type = 'load'),
            count(*) filter (where type = 'viewable'),
            count(*) filter (where type = 'product_impression'),
            count(*) filter (where type = 'click')
     from event
     where ts >= date_trunc('hour', now()) - interval '3 hours'
       and not quality_flags ? 'bot_ua'
     group by 1, 2, 3, 4, 5, 6
     on conflict (hour, placement_id, instance_id, advertiser_id, site_id, device_class)
     do update set loads = excluded.loads, viewables = excluded.viewables,
                   product_impressions = excluded.product_impressions, clicks = excluded.clicks
     returning hour`,
    [ZERO],
  );
  return NextResponse.json({ ok: true, rows: rows.length });
}
