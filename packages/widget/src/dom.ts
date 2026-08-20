// Tiny DOM helper. Product/feed data is untrusted — everything is set via
// textContent/attributes, never innerHTML.

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

/** Anchor helper: click URLs open in a new tab with rel hardening. */
export function link(
  href: string,
  className: string,
  children: (Node | string | undefined)[],
): HTMLAnchorElement {
  return h('a', { href, class: className, target: '_blank', rel: 'noopener sponsored' }, children);
}
