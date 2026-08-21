import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
// The app is served under a base path (see next.config.mjs) because it is
// exposed at stepnetwork.dk/stepcommerce via a rewrite in the website project.
//
// Route handlers do NOT see it: Next strips the base path before routing, and
// `req.nextUrl.basePath` is empty there. Anything that builds an absolute or
// root-relative URL for the browser must therefore use this constant rather
// than asking the request.
export const BASE_PATH = '/stepcommerce';

/** Root-relative URL for a browser-facing path, e.g. "/stepcommerce/w.js". */
export function basePathUrl(path: string): string {
  return BASE_PATH + (path.startsWith('/') ? path : `/${path}`);
}

/**
 * Redirect from a server action.
 *
 * A bare path is NOT reliable here: Next prepends the base path to a server
 * action's redirect only when the router happens to handle it client-side, so
 * the same call lands on /widgets/x (404) after a hard load and on
 * /stepcommerce/stepcommerce/widgets/x after a soft one. An absolute URL is
 * unambiguous, so that is what we always send.
 *
 * MUST be awaited — it throws to abort the action, and an un-awaited call would
 * let the rest of the action keep running.
 */
export async function redirectWithBasePath(path: string): Promise<never> {
  let base = process.env.PUBLIC_ORIGIN?.replace(/\/+$/, '');
  if (!base) {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
    const proto = h.get('x-forwarded-proto') ?? (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
    base = `${proto}://${host}${BASE_PATH}`;
  }
  redirect(base + (path.startsWith('/') ? path : `/${path}`));
}
