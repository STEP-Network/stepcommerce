// POST /api/serve (spec §7): placement code + KV map in, fully resolved widget
// payload out. Edge-cacheable per (placement, KV-signature) with a short TTL.
import { NextRequest, NextResponse } from 'next/server';
import { resolveServe } from '@/lib/resolve';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { placement?: string; kv?: Record<string, string>; preview?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ render: false, reason: 'bad_request' }, { status: 400 });
  }
  if (!body.placement || typeof body.placement !== 'string') {
    return NextResponse.json({ render: false, reason: 'missing_placement' }, { status: 400 });
  }
  const kv: Record<string, string> = {};
  for (const [k, v] of Object.entries(body.kv ?? {})) {
    if (typeof v === 'string' && k.length <= 128 && v.length <= 2048) kv[k] = v;
  }
  // Unresolved GAM macros arrive verbatim ("%%PATTERN:key%%") — drop them.
  for (const k of Object.keys(kv)) if (kv[k].startsWith('%%')) delete kv[k];

  // PUBLIC_ORIGIN must include the base path (e.g. https://stepnetwork.dk/stepcommerce).
  const origin = process.env.PUBLIC_ORIGIN ?? req.nextUrl.origin + (req.nextUrl.basePath || '');
  try {
    const result = await resolveServe({
      placementCode: body.placement,
      kv,
      origin,
      preview: body.preview === true && req.nextUrl.searchParams.get('preview_key') === process.env.PREVIEW_KEY,
    });
    return NextResponse.json(result, {
      headers: { 'cache-control': 'public, s-maxage=120, stale-while-revalidate=60' },
    });
  } catch {
    // Fail closed but valid: the widget collapses gracefully.
    return NextResponse.json({ render: false, reason: 'error' }, { status: 200 });
  }
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204 });
}
