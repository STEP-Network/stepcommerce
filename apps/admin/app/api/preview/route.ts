// GET /api/preview?placement=PLC_x&kv=key%3Dvalue%3Bkey2%3Dvalue2
//
// Admin-only (covered by the Basic-auth middleware) resolve that also accepts
// draft instances, so a configuration can be seen rendering with real feed data
// before it is ever set live. The widget loader consumes this via data-mock,
// which means the preview exercises the real renderer, not a mock-up.
import { NextRequest, NextResponse } from 'next/server';
import { resolveServe } from '@/lib/resolve';
import { BASE_PATH } from '@/lib/base-path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const placement = req.nextUrl.searchParams.get('placement');
  if (!placement) return NextResponse.json({ render: false, reason: 'missing_placement' });

  const kv: Record<string, string> = {};
  for (const pair of (req.nextUrl.searchParams.get('kv') ?? '').split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) kv[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  const origin = process.env.PUBLIC_ORIGIN ?? req.nextUrl.origin + BASE_PATH;
  try {
    const result = await resolveServe({
      placementCode: placement,
      kv,
      origin,
      deviceClass: req.nextUrl.searchParams.get('device') ?? 'desktop',
      preview: true,
    });
    return NextResponse.json(result, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({
      render: false,
      reason: 'error',
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
