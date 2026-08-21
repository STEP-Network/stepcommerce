// w.js entry point (spec §7). Two modes:
//  1. Direct embed — auto-inits from its own script tag:
//     <script async src="https://stepnetwork.dk/stepcommerce/w.js" data-placement="PLC_abc123"></script>
//  2. GAM HTML5 creative — the creative HTML calls window.STEPCommerce.init({...})
//     with KVs pre-injected via %%PATTERN%% macros and %%CLICK_URL_UNESC%% as clickMacro.
// Everything fails silent: a broken widget must never break the publisher page.

import { collectKv, deviceClass } from './kv';
import { mount } from './render';
import type { ServeResponse, WidgetConfig } from './types';

const DONE_ATTR = 'data-sc-done';

/** Placements already initialised in this document, so a snippet pasted twice
 *  does not render two widgets and double-count every impression. */
function claimed(): Set<string> {
  const w = window as { __scClaimed?: Set<string> };
  w.__scClaimed = w.__scClaimed ?? new Set<string>();
  return w.__scClaimed;
}

async function fetchServe(config: WidgetConfig, kv: Record<string, string>, serveUrl: string): Promise<ServeResponse | null> {
  try {
    if (config.mockUrl) {
      const res = await fetch(config.mockUrl, { credentials: 'same-origin' });
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

/**
 * Where to put the widget. A publisher pasting an async tag into <head> is
 * common, and inserting there renders the widget inside `head { display: none }`
 * — a total, silent failure. Only a script that actually sits in the body can
 * anchor the container.
 */
function createContainer(script: HTMLScriptElement | null, placement: string): HTMLElement | null {
  try {
    // data-container="#some-id" renders into an existing element instead of
    // next to the tag. Publishers frequently want the widget in a specific
    // slot, and script tags get relocated by tag managers and frameworks, so
    // relying on tag position alone is fragile.
    const selector = script?.getAttribute('data-container');
    if (selector) {
      const target = document.querySelector(selector);
      if (target instanceof HTMLElement) {
        const child = document.createElement('div');
        child.setAttribute('data-sc-widget', placement);
        target.appendChild(child);
        return child;
      }
      return null; // an explicit target that does not exist must not fall back
    }
    const container = document.createElement('div');
    container.setAttribute('data-sc-widget', placement);
    // Reserve space up front so filling it later is not a layout shift on the
    // publisher's page (CLS is one of the things we are selling against).
    const reserved = script?.getAttribute('data-min-height');
    if (reserved && /^\d{1,4}$/.test(reserved)) container.style.minHeight = `${reserved}px`;

    const inBody = script && script.parentNode && document.body && document.body.contains(script);
    if (inBody && script.parentNode) {
      script.parentNode.insertBefore(container, script.nextSibling);
      return container;
    }
    if (document.body) {
      document.body.appendChild(container);
      return container;
    }
    return null;
  } catch {
    return null;
  }
}

async function init(config: WidgetConfig, script?: HTMLScriptElement | null): Promise<void> {
  let container: HTMLElement | null = config.container ?? null;
  let created = false;
  try {
    if (!config.placement) return;
    if (!config.container) {
      if (claimed().has(config.placement)) return; // duplicate snippet
      claimed().add(config.placement);
    }
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

    if (!container) {
      container = createContainer(script ?? null, config.placement);
      created = true;
    }
    if (!container) return;
    if (!mount(container, serve, kv, deviceClass(), config.clickMacro) && created) {
      container.remove(); // never leave an empty box on the page
    }
  } catch {
    try {
      if (created && container) container.remove();
    } catch {
      /* fail silent */
    }
  }
}

function autoInit(): void {
  try {
    // Claim every unprocessed tag in one pass: marking the attribute before the
    // async init runs makes the selection atomic, so no tag is initialised twice
    // and none is skipped when several tags share one bundle execution.
    const tags = Array.from(
      document.querySelectorAll<HTMLScriptElement>(`script[data-placement]:not([${DONE_ATTR}])`),
    );
    for (const script of tags) {
      script.setAttribute(DONE_ATTR, '1');
      const config: WidgetConfig = {
        placement: script.getAttribute('data-placement') ?? '',
        serveUrl: script.getAttribute('data-serve') ?? undefined,
        mockUrl: script.getAttribute('data-mock') ?? undefined,
      };
      void init(config, script);
    }
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
    // The manual entry point never adopts an unrelated embed tag: doing so let a
    // hand-written init() steal another placement's data-kv, serve URL and slot.
    init: (config: WidgetConfig) => void init(config, null),
  };
  autoInit();
} catch {
  /* fail silent */
}
