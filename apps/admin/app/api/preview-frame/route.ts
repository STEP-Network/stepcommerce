// Standalone HTML page for the preview iframe. Rendering the widget inside an
// iframe rather than in the admin's React tree is both simpler and more
// faithful: the widget genuinely runs on its own page, exactly as it will on a
// publisher's, with no framework hydration interfering with its DOM.
import { NextRequest, NextResponse } from 'next/server';
import { BASE_PATH } from '@/lib/base-path';

export const dynamic = 'force-dynamic';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function GET(req: NextRequest): NextResponse {
  const placement = req.nextUrl.searchParams.get('placement') ?? '';
  const kv = req.nextUrl.searchParams.get('kv') ?? '';
  const device = req.nextUrl.searchParams.get('device') ?? 'desktop';
  // Route handlers never see the base path, so take it from the constant.
  const base = BASE_PATH;
  const mock = `${base}/api/preview?placement=${encodeURIComponent(placement)}&kv=${encodeURIComponent(kv)}&device=${encodeURIComponent(device)}`;

  const html = `<!DOCTYPE html>
<html lang="da"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  html,body{margin:0;padding:0;background:#f3efe3;
    font-family:"Segoe UI",system-ui,-apple-system,Arial,sans-serif;color:#2e2c26}
  .frame{padding:18px}
  .empty{color:#8a8574;font-size:13px;padding:12px;border:1px dashed #c9c3ae;border-radius:8px;text-align:center}
</style></head>
<body><div class="frame">
  <div id="slot"></div>
  <div class="empty" id="empty">Widgetten renderede ikke — se årsagen ovenfor.</div>
  <script>
    // Hide the placeholder as soon as the widget mounts something.
    new MutationObserver(function (m, obs) {
      if (document.querySelector('#slot [data-sc-widget]')) {
        document.getElementById('empty').style.display = 'none';
        obs.disconnect();
      }
    }).observe(document.getElementById('slot'), { childList: true, subtree: true });
  </script>
  <script async src="${esc(base)}/w.js"
          data-placement="${esc(placement)}"
          data-mock="${esc(mock)}"
          data-container="#slot"></script>
</div></body></html>`;

  return new NextResponse(html, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
