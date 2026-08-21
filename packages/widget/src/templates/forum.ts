// Template A — "Native forum post" (approved prototype: lav-det-selv.dk × Harald Nyborg).
// Renders as a forum post in the thread flow: advertiser logo as avatar,
// advertiser name with a "Sponsoreret" badge, quiet ANNONCE marking, forum-voice
// copy, a flipping tilbudsavis (auto page-flip ~2.6s with a peeling corner),
// an optional "Relevant for denne tråd" context strip, and a pulsing CTA.

import { h, img, link, safe } from '../dom';
import type { ServeProduct, TemplateMeta } from '../types';
import type { Tracker } from '../track';

export const forumCss = `
.fp-post{background:var(--sc-surface);border:1px solid var(--sc-border);border-radius:var(--sc-radius);box-shadow:var(--sc-shadow);position:relative}
.fp-adlabel{position:absolute;top:10px;right:14px}
.fp-head{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--sc-border)}
.fp-avatar{width:34px;height:34px;border-radius:50%;background:var(--sc-accent);display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden;padding:6px}
.fp-avatar img{width:100%;height:auto}
.fp-who{flex:1;min-width:0}
.fp-name{font-weight:600;color:var(--sc-accent);font-size:.9em}
.fp-badge{display:inline-block;font-size:.66em;background:color-mix(in srgb,var(--sc-accent) 10%,var(--sc-surface));border:1px solid color-mix(in srgb,var(--sc-accent) 35%,var(--sc-surface));color:var(--sc-accent);border-radius:8px;padding:0 7px;margin-left:5px;vertical-align:1px}
.fp-meta{font-size:.72em;color:var(--sc-text2);margin-top:1px}
.fp-when{font-size:.76em;color:var(--sc-text2)}
.fp-body{padding:14px 16px 16px}
.fp-copy{margin-bottom:12px;font-size:.93em}
.fp-flex{display:flex;gap:16px;align-items:stretch}
.fp-aviswrap{flex-shrink:0;perspective:900px;width:148px}
.fp-avis{position:relative;width:148px;height:196px;border-radius:3px;box-shadow:0 3px 10px rgba(0,0,0,.18);cursor:pointer;display:block}
.fp-page{position:absolute;inset:0;border-radius:3px;overflow:hidden;backface-visibility:hidden;transform-origin:left center;transition:transform 1.1s cubic-bezier(.55,.06,.24,.99);background:var(--sc-surface)}
/* visibility:hidden (not just opacity) so flipped pages leave the
   accessibility tree — otherwise the catalogue link's accessible name is every
   offer on every page concatenated. */
.fp-page.flipped{transform:rotateY(-102deg);opacity:0;visibility:hidden;transition:transform 1.1s cubic-bezier(.55,.06,.24,.99),opacity .3s .8s,visibility 0s .9s}
.fp-front{background:linear-gradient(165deg,var(--sc-accent2) 0%,var(--sc-accent) 78%);color:#fff;display:flex;flex-direction:column;padding:12px 12px 10px}
.fp-front img{width:108px;height:auto}
.fp-front .name{font-weight:800;font-size:1.05em;letter-spacing:.04em}
.fp-front .uge{font-size:.66em;opacity:.85;margin-top:1px}
.fp-front .hero{margin-top:auto;background:rgba(255,255,255,.16);border-radius:4px;padding:8px;font-size:.72em;line-height:1.35}
.fp-splash{position:absolute;top:58px;right:8px;width:62px;height:62px;background:var(--sc-splash-bg);color:var(--sc-splash-text);border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;font-weight:800;transform:rotate(8deg);box-shadow:0 2px 5px rgba(0,0,0,.25);overflow:hidden;text-align:center;padding:2px}
.fp-splash .p{font-size:1em;line-height:1;max-width:100%;overflow:hidden}
.fp-splash .l{font-size:.52em;font-weight:700}
.fp-spread{display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:10px;background:color-mix(in srgb,var(--sc-surface) 92%,var(--sc-border))}
.fp-offer{background:var(--sc-surface);border:1px solid var(--sc-border);border-radius:3px;padding:6px;position:relative;font-size:.62em;min-width:0}
.fp-offer .ph{height:38px;border-radius:2px;margin-bottom:5px;background:linear-gradient(135deg,var(--sc-accent2),var(--sc-accent));opacity:.55}
.fp-offer img{height:38px;width:100%;object-fit:cover;border-radius:2px;margin-bottom:5px}
.fp-offer .t{font-weight:600;color:var(--sc-text);line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.fp-offer .pr{color:var(--sc-price);font-weight:800;font-size:1.25em;margin-top:2px}
.fp-offer .was{color:var(--sc-text2);text-decoration:line-through;font-size:.72em;margin-left:3px;font-weight:400}
.fp-corner{position:absolute;bottom:0;right:0;width:26px;height:26px;background:linear-gradient(315deg,rgba(0,0,0,.06) 47%,rgba(0,0,0,.14) 50%,var(--sc-surface) 53%);border-radius:3px 0 3px 0;animation:fp-peel 2.6s ease-in-out infinite}
@keyframes fp-peel{0%,100%{width:26px;height:26px}50%{width:34px;height:34px}}
.fp-right{flex:1;display:flex;flex-direction:column;min-width:0}
.fp-ctxlabel{font-size:.66em;color:var(--sc-accent);text-transform:uppercase;letter-spacing:.8px;margin-bottom:5px}
.fp-ctxs{display:flex;gap:8px;margin:2px 0 12px}
.fp-ctx{flex:1;border:1px solid var(--sc-border);border-radius:4px;padding:8px 9px;font-size:.76em;background:color-mix(in srgb,var(--sc-surface) 96%,var(--sc-border));min-width:0;display:block}
.fp-ctx .ct{font-weight:600;color:var(--sc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fp-ctx .cp{color:var(--sc-price);font-weight:800;font-size:1.1em}
.fp-ctx .cl{font-size:.8em;color:var(--sc-text2)}
.fp-cta{margin-top:auto;align-self:flex-start}
.fp-foot{font-size:.66em;color:var(--sc-text2);margin-top:8px}
@media (max-width:560px){.fp-flex{flex-direction:column}.fp-aviswrap{align-self:center}.fp-ctxs{flex-wrap:wrap}}
`;

function offer(p: ServeProduct): HTMLElement {
  const el = h('div', { class: 'fp-offer' });
  el.append(img(p.imageUrl, p.title) ?? h('div', { class: 'ph' }));
  el.append(h('div', { class: 't' }, [p.title]));
  const pr = h('div', { class: 'pr' }, [p.salePrice ?? p.price ?? '']);
  if (p.salePrice && p.price) pr.append(h('span', { class: 'was' }, [p.price]));
  el.append(pr);
  return el;
}

export function renderForum(
  root: HTMLElement,
  products: ServeProduct[],
  meta: TemplateMeta,
  tracker: Tracker,
  wrapClick: (url: string) => string,
): void {
  const advertiser = meta.advertiserName || '';
  const post = h('div', { class: 'fp-post' });
  post.append(h('span', { class: 'sc-annonce fp-adlabel' }, ['Annonce']));

  const head = h('div', { class: 'fp-head' });
  const avatar = h('div', { class: 'fp-avatar' });
  const logo = img(meta.advertiserLogoUrl, advertiser);
  if (logo) avatar.append(logo);
  else avatar.append(h('span', { style: 'color:#fff;font-weight:700;font-size:.8em' }, [advertiser.slice(0, 2).toUpperCase()]));
  const who = h('div', { class: 'fp-who' });
  const nameLine = h('div');
  nameLine.append(
    h('span', { class: 'fp-name' }, [advertiser]),
    h('span', { class: 'fp-badge' }, [meta.sponsoredLabel ?? 'Sponsoreret']),
  );
  who.append(nameLine);
  if (meta.catalogTitle) who.append(h('div', { class: 'fp-meta' }, [meta.catalogTitle]));
  head.append(avatar, who, h('span', { class: 'fp-when' }, [meta.timestampLabel ?? 'I dag']));
  post.append(head);

  const body = h('div', { class: 'fp-body' });
  if (meta.copy) body.append(h('div', { class: 'fp-copy' }, [meta.copy]));

  const flex = h('div', { class: 'fp-flex' });
  // Prefer a tracked product click URL: a hand-set ctaUrl bypasses /c entirely,
  // so the highest-intent click in the widget would never be logged. Falling
  // back to no link at all is better than a dead '#'.
  const ctaTarget = products[0]?.clickUrl ?? meta.ctaUrl;
  const ctaUrl = ctaTarget ? wrapClick(ctaTarget) : undefined;

  // Tilbudsavis: front page + up to 2 spreads of 4 offers, stacked back-to-front.
  const wrap = h('div', { class: 'fp-aviswrap' });
  const avis = link(ctaUrl, 'fp-avis', []);
  avis.setAttribute('aria-label', `Se tilbudsavisen fra ${advertiser}`);
  avis.title = 'Se tilbudsavisen';
  const spreads: HTMLElement[] = [];
  for (let i = 0; i < Math.min(2, Math.ceil(products.length / 4)); i++) {
    const spread = h('div', { class: 'fp-page fp-spread' });
    products.slice(i * 4, i * 4 + 4).forEach((p) => {
      const o = offer(p);
      tracker.observeProduct(o, p.id);
      spread.append(o);
    });
    spreads.push(spread);
  }
  // DOM order: last spread first (bottom of the stack), front page last (top).
  for (let i = spreads.length - 1; i >= 0; i--) {
    spreads[i].style.zIndex = String(spreads.length - i);
    avis.append(spreads[i]);
  }
  const front = h('div', { class: 'fp-page fp-front' });
  front.style.zIndex = String(spreads.length + 1);
  const frontLogo = img(meta.advertiserLogoUrl, advertiser);
  if (frontLogo) front.append(frontLogo);
  else front.append(h('div', { class: 'name' }, [advertiser]));
  if (meta.catalogTitle) front.append(h('div', { class: 'uge' }, [meta.catalogTitle]));
  const badgeProduct = products.find((p) => p.badge);
  if (badgeProduct?.badge) {
    const splash = h('div', { class: 'fp-splash' });
    // The splash is a fixed 62px circle: a long badge would destroy the layout.
    splash.append(h('div', { class: 'p' }, [badgeProduct.badge.slice(0, 8)]));
    front.append(splash);
  }
  const hero = meta.heroText ?? products[0]?.title;
  if (hero) front.append(h('div', { class: 'hero' }, [hero]));
  front.append(h('div', { class: 'fp-corner' }));
  avis.append(front);
  wrap.append(avis);
  flex.append(wrap);

  // Auto page-flip every ~2.6s; skipped entirely under prefers-reduced-motion.
  // WCAG 2.2.2: it stops after a few cycles and pauses on hover/focus, and the
  // interval clears itself once the widget leaves the DOM — otherwise an SPA
  // route change leaks the whole widget tree and keeps animating forever.
  try {
    const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pages = [front, ...spreads];
    if (!reduced && pages.length > 1) {
      let idx = 0;
      let cycles = 0;
      let paused = false;
      const timer = setInterval(
        safe(() => {
          if (!avis.isConnected || cycles >= 3) {
            clearInterval(timer);
            return;
          }
          if (paused || (typeof document !== 'undefined' && document.hidden)) return;
          if (idx < pages.length - 1) {
            pages[idx].classList.add('flipped');
            idx++;
          } else {
            pages.forEach((p) => p.classList.remove('flipped'));
            idx = 0;
            cycles++;
          }
        }),
        2600,
      );
      const pause = safe(() => { paused = true; });
      const resume = safe(() => { paused = false; });
      avis.addEventListener('mouseenter', pause);
      avis.addEventListener('focusin', pause);
      avis.addEventListener('mouseleave', resume);
      avis.addEventListener('focusout', resume);
    }
  } catch {
    /* fail silent */
  }

  // Right column: context strip + CTA + footer.
  const right = h('div', { class: 'fp-right' });
  const ctx = meta.contextProducts ?? [];
  if (ctx.length) {
    right.append(h('div', { class: 'fp-ctxlabel' }, [meta.contextStripLabel ?? 'Relevant for denne tråd']));
    const strip = h('div', { class: 'fp-ctxs' });
    for (const p of ctx.slice(0, 3)) {
      const item = link(wrapClick(p.clickUrl), 'fp-ctx', []);
      item.append(h('div', { class: 'ct' }, [p.title]));
      item.append(h('div', { class: 'cp' }, [p.salePrice ?? p.price ?? '']));
      if (p.subtitle) item.append(h('div', { class: 'cl' }, [p.subtitle]));
      tracker.observeProduct(item, p.id);
      strip.append(item);
    }
    right.append(strip);
  }
  if (ctaUrl) {
    const cta = link(ctaUrl, 'sc-cta fp-cta', [meta.ctaLabel ?? 'Se tilbudsavisen →']);
    cta.setAttribute('aria-label', `${meta.ctaLabel ?? 'Se tilbudsavisen'} — ${advertiser}`);
    right.append(cta);
  }
  right.append(h('div', { class: 'fp-foot' }, ['Annonce · leveres af STEP Commerce']));
  flex.append(right);

  body.append(flex);
  post.append(body);
  root.append(post);
}
