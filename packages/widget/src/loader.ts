// w.js entry point (spec §7). Two modes:
//  1. Direct embed — auto-inits from its own script tag:
//     <script async src="https://widgets.stepnetwork.dk/w.js" data-placement="PLC_abc123"></script>
//  2. GAM HTML5 creative — the creative HTML calls window.STEPCommerce.init({...})
//     with KVs pre-injected via %%PATTERN%% macros and %%CLICK_URL_UNESC%% as clickMacro.
// Everything fails silent: a broken widget must never break the publisher page.

import { collectKv, deviceClass } from './kv';
import { mount } from './render';
import type { ServeResponse, WidgetConfig } from './types';

function ownScript(): HTMLScriptElement | null {
  try {
    const current = document.currentScript as HTMLScriptElement | null;
    if (current?.getAttribute('data-placement')) return current;
    // async scripts can lose currentScript; find the first unprocessed tag
    const tags = document.querySelectorAll<HTMLScriptElement>('script[data-placement]:not([data-sc-done])');
    return tags[0] ?? null;
  } catch {
    return null;
  }
}

async function fetchServe(config: WidgetConfig, kv: Record<string, string>, serveUrl: string): Promise<ServeResponse | null> {
  try {
    if (config.mockUrl) {
      const res = await fetch(config.mockUrl);
      return res.ok ? ((await res.json()) as ServeResponse) : null;
    }
    const res = await fetch(serveUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        placement: config.placement,
        kv,
        device_class: deviceClass(),
        viewport: { w: window.innerWidth, h: window.innerHeight },
      }),
    });
    return res.ok ? ((await res.json()) as ServeResponse) : null;
  } catch {
    return null;
  }
}

async function init(config: WidgetConfig, script?: HTMLScriptElement | null): Promise<void> {
  try {
    if (!config.placement) return;
    const kv = collectKv(script ?? null, config.kv);
    // Derive the API base from the script URL including any base path
    // (https://stepnetwork.dk/stepcommerce/w.js → .../stepcommerce/api/serve).
    let base = window.location.origin;
    if (script?.src) {
      const u = new URL(script.src);
      base = u.origin + u.pathname.replace(/\/w\.js$/, '');
    }
    const serveUrl = config.serveUrl ?? base + '/api/serve';

    const serve = await fetchServe(config, kv, serveUrl);
    if (!serve?.render) return;

    let container = config.container;
    if (!container) {
      container = document.createElement('div');
      container.setAttribute('data-sc-widget', config.placement);
      if (script?.parentNode) script.parentNode.insertBefore(container, script.nextSibling);
      else document.body.appendChild(container);
    }
    mount(container, serve, kv, deviceClass(), config.clickMacro);
  } catch {
    /* fail silent */
  }
}

function autoInit(): void {
  try {
    const script = ownScript();
    if (!script) return;
    script.setAttribute('data-sc-done', '1');
    const config: WidgetConfig = {
      placement: script.getAttribute('data-placement') ?? '',
      serveUrl: script.getAttribute('data-serve') ?? undefined,
      mockUrl: script.getAttribute('data-mock') ?? undefined,
    };
    void init(config, script);
  } catch {
    /* fail silent */
  }
}

declare global {
  interface Window {
    STEPCommerce?: { init: (config: WidgetConfig) => void };
  }
}

try {
  window.STEPCommerce = window.STEPCommerce ?? {
    init: (config: WidgetConfig) => void init(config, ownScript()),
  };
  autoInit();
} catch {
  /* fail silent */
}
