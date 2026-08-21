// Tiny DOM helper. Product/feed data is untrusted — everything is set via
// textContent/attributes, never innerHTML.

/**
 * Wraps a callback so it can never throw into the publisher's page. try/catch
 * around the code that SCHEDULES a callback does not protect the callback
 * itself, so every observer/timer/listener boundary must be wrapped here —
 * that makes fail-silent a property of the code rather than of luck.
 */
export function safe<A extends unknown[]>(fn: (...args: A) => void): (...args: A) => void {
  return (...args: A): void => {
    try {
      fn(...args);
    } catch {
      /* fail silent */
    }
  };
}

/**
 * Only absolute http(s) URLs may become an href or src. Product links, CTA URLs
 * and the GAM click macro all originate outside this code.
 */
export function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Record<string, string | undefined>,
  children?: (Node | string | undefined)[],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined) continue;
      if (key === 'class') el.className = value;
      else el.setAttribute(key, value);
    }
  }
  if (children) {
    for (const child of children) {
      if (child === undefined) continue;
      el.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
  }
  return el;
}

/**
 * Anchor helper: click URLs open in a new tab with rel hardening. A URL that is
 * not absolute http(s) yields a non-navigating element rather than a link, so a
 * bad feed or an unexpanded GAM macro cannot produce a javascript: href or a
 * relative 404 on the publisher's own domain.
 */
export function link(
  href: string | undefined,
  className: string,
  children: (Node | string | undefined)[],
): HTMLElement {
  const safeHref = safeUrl(href);
  if (!safeHref) return h('div', { class: className }, children);
  return h('a', { href: safeHref, class: className, target: '_blank', rel: 'noopener sponsored' }, children);
}

/** Image helper: same URL discipline, plus explicit dimensions to avoid CLS. */
export function img(src: string | undefined, alt: string, attrs?: Record<string, string>): HTMLElement | undefined {
  const safeSrc = safeUrl(src);
  if (!safeSrc) return undefined;
  return h('img', { src: safeSrc, alt, loading: 'lazy', decoding: 'async', ...attrs });
}
