// POST /api/serve (spec §7): placement code + KV map in, fully resolved widget
// payload out. Edge-cacheable per (placement, KV-signature) with a short TTL.
import { NextRequest, NextResponse } from 'next/server';
import { recordServeDecision, resolveServe } from '@/lib/resolve';
import { BASE_PATH } from '@/lib/base-path';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { placement?: string; kv?: Record<string, string>; preview?: boolean; device_class?: unknown };
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
  // In production it is required: falling back to the request Host would emit
  // click/beacon URLs on whatever hostname the request arrived at (the rewrite's
  // upstream *.vercel.app rather than the first-party domain), which quietly
  // loses clicks to ad blockers and makes the destination header-controlled.
  const origin = process.env.PUBLIC_ORIGIN
    ?? (process.env.NODE_ENV === 'production'
      ? null
      : req.nextUrl.origin + BASE_PATH);
  if (!origin) {
    return NextResponse.json({ render: false, reason: 'misconfigured_origin' }, { status: 200 });
  }
  try {
    const result = await resolveServe({
      placementCode: body.placement,
      kv,
      origin,
      deviceClass: typeof body.device_class === 'string' ? body.device_class : undefined,
      preview: body.preview === true && req.nextUrl.searchParams.get('preview_key') === process.env.PREVIEW_KEY,
    });
    await recordServeDecision(body.placement, result.render ? 'rendered' : (result.reason ?? 'unknown'));
    // Deliberately NOT cacheable: the resolved payload depends on the request
    // body (the page's key-values), which no shared cache keys on. A URL-keyed
    // cache would serve one article's products on another article — exactly the
    // wrong-context render the fallback chain exists to prevent.
    return NextResponse.json(result, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    await recordServeDecision(body.placement, 'error');
    // Fail closed but valid: the widget collapses gracefully.
    return NextResponse.json({ render: false, reason: 'error' }, { status: 200 });
  }
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204 });
}
