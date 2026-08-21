// V1 auth: HTTP Basic against ADMIN_USER/ADMIN_PASSWORD for the admin UI.
// Public surfaces (serve, events, click redirect, demo feed, w.js) are excluded —
// cron has its own CRON_SECRET check. STEP SSO replaces this before broad rollout.
//
// The matcher needs BOTH entries: the pattern below compiles to a regex whose
// path-segment group is mandatory, so it does not match the basePath root
// itself. Without the explicit '/' entry, GET /stepcommerce (the canonical
// dashboard URL) bypasses auth entirely. Exclusions are anchored so a future
// route like /api/serve-preview cannot inherit the bypass.
import { NextRequest, NextResponse } from 'next/server';

export const config = {
  matcher: [
    '/',
    '/((?!api/serve$|api/events$|api/cron/|api/demo-feed$|c/|w\\.js$|_next/|favicon).*)',
  ],
};

/** Length-independent comparison so credentials are not a timing oracle. */
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function unauthorized(): NextResponse {
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'www-authenticate': 'Basic realm="STEP Commerce Admin"' },
  });
}

export function middleware(req: NextRequest): NextResponse {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASSWORD;
  if (!user || !pass) {
    // Fail CLOSED in production: a missing or emptied env var must never
    // silently open the admin to the internet.
    if (process.env.NODE_ENV === 'production') return unauthorized();
    return NextResponse.next(); // local dev without auth
  }

  const header = req.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(':'); // split on the FIRST colon — passwords may contain colons
      if (sep > 0) {
        const okUser = safeEqual(decoded.slice(0, sep), user);
        const okPass = safeEqual(decoded.slice(sep + 1), pass);
        if (okUser && okPass) return NextResponse.next();
      }
    } catch {
      // malformed base64 — fall through to 401 rather than throwing a 500
    }
  }
  return unauthorized();
}
