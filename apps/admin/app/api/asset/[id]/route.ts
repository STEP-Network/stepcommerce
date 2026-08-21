// GET /api/asset/{id} — serves an uploaded asset (advertiser logos).
//
// Public on purpose: logos are rendered inside widgets on publisher pages, so
// this must be reachable without admin auth. Assets are immutable once created
// (a new upload gets a new id), so they can be cached hard.
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID.test(id)) return new NextResponse('not found', { status: 404 });

  const rows = await query<{ bytes: Buffer | Uint8Array; content_type: string }>(
    'select bytes, content_type from asset where id = $1',
    [id],
  );
  if (!rows[0]) return new NextResponse('not found', { status: 404 });

  const raw = rows[0].bytes;
  const body = raw instanceof Uint8Array ? raw : new Uint8Array(raw as unknown as ArrayBufferLike);
  return new NextResponse(body as unknown as BodyInit, {
    headers: {
      'content-type': rows[0].content_type,
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    },
  });
}
