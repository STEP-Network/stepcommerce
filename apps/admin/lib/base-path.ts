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
