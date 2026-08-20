// POST /api/events (spec §8): append-only ingestion of load / viewable /
// product_impression beacons. Clicks are logged by the /c redirect, not here.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const TYPES = new Set(['load', 'viewable', 'product_impression']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json();
    if (!TYPES.has(body.type)) return NextResponse.json({ ok: false }, { status: 400 });
    const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null);
    const kv: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.kv_context ?? {})) {
      if (typeof v === 'string' && k.length <= 128) kv[k] = v.slice(0, 512);
    }
    const quality: string[] = [];
    const ua = req.headers.get('user-agent') ?? '';
    if (/bot|crawler|spider|headless/i.test(ua)) quality.push('bot_ua');
    await query(
      `insert into event (type, placement_id, instance_id, advertiser_id, product_id, site_id, kv_context, device_class, quality_flags)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)`,
      [
        body.type,
        uuid(body.placement_id),
        uuid(body.instance_id),
        uuid(body.advertiser_id),
        uuid(body.product_id),
        uuid(body.site_id),
        JSON.stringify(kv),
        typeof body.device_class === 'string' ? body.device_class.slice(0, 16) : null,
        JSON.stringify(quality),
      ],
    );
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 }); // beacons are fire-and-forget
  }
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204 });
}
