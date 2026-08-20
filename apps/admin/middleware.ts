// V1 auth: HTTP Basic against ADMIN_USER/ADMIN_PASSWORD for the admin UI.
// Public surfaces (serve, events, click redirect, cron) are excluded — cron
// has its own CRON_SECRET check. STEP SSO replaces this before broad rollout.
import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: ['/((?!api/serve|api/events|api/cron|c/|w\\.js|_next|favicon).*)'],
};

export function middleware(req: NextRequest): NextResponse {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) return NextResponse.next(); // local dev without auth

  const header = req.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    const [u, p] = atob(header.slice(6)).split(':');
    if (u === user && p === pass) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="STEP Commerce Admin"' },
  });
}
