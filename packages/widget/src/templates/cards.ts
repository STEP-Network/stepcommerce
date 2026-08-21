// Generic card layouts: carousel | grid | stacked | single_card (spec §6).
// The approved native templates (forum_post, recipe_section) are the V1 flagship
// designs; these cover conventional fixed-size placements like 930×180.

import { h, img, link } from '../dom';
import type { ServeProduct, TemplateId, TemplateMeta } from '../types';
import type { Tracker } from '../track';

export const cardsCss = `
.cd-wrap{background:var(--sc-surface);border:1px solid var(--sc-border);border-radius:var(--sc-radius);box-shadow:var(--sc-shadow);padding:12px;position:relative}
.cd-adlabel{position:absolute;top:6px;right:10px}
.cd-track{display:grid;gap:10px}
.cd-track--grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
.cd-track--stacked{grid-template-columns:1fr}
.cd-track--carousel{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:thin;padding-bottom:4px}
.cd-track--carousel .cd-card{flex:0 0 150px;scroll-snap-align:start}
.cd-card{border:1px solid var(--sc-border);border-radius:calc(var(--sc-radius) - 2px);padding:10px;display:flex;flex-direction:column;background:var(--sc-surface);min-width:0}
.cd-imgwrap{aspect-ratio:var(--sc-img-ratio);border-radius:3px;overflow:hidden;margin-bottom:8px;background:color-mix(in srgb,var(--sc-surface) 92%,var(--sc-border))}
.cd-imgwrap img{width:100%;height:100%;object-fit:var(--sc-img-fit)}
.cd-title{font-size:.85em;font-weight:600;color:var(--sc-text)}
.cd-brand{font-size:.72em;color:var(--sc-text2);margin-top:2px}
.cd-price{font-size:1em;font-weight:700;color:var(--sc-price);margin-top:auto;padding-top:8px}
.cd-price .was{font-size:.72em;color:var(--sc-text2);text-decoration:line-through;font-weight:400;margin-left:4px}
.cd-badge{position:absolute;margin:6px}
.cd-cta{margin-top:8px;text-align:center;font-size:.82em}
.cd-foot{font-size:.66em;color:var(--sc-text2);margin-top:10px;text-align:right}
`;

export function renderCards(
  root: HTMLElement,
  layout: TemplateId,
  products: ServeProduct[],
  meta: TemplateMeta,
  tracker: Tracker,
  wrapClick: (url: string) => string,
): void {
  const advertiser = meta.advertiserName || '';
  const wrap = h('div', { class: 'cd-wrap' });
  wrap.append(h('span', { class: 'sc-annonce cd-adlabel' }, ['Annonce']));
  const mode = layout === 'single_card' ? 'stacked' : layout;
  const track = h('div', { class: `cd-track cd-track--${mode}` });
  if (mode === 'carousel') {
    // A horizontally scrollable region must be keyboard reachable (WCAG 2.1.1).
    track.setAttribute('tabindex', '0');
    track.setAttribute('role', 'group');
    track.setAttribute('aria-label', 'Produkter');
  }
  const list = layout === 'single_card' ? products.slice(0, 1) : products;
  for (const p of list) {
    const card = link(wrapClick(p.clickUrl), 'cd-card', []);
    card.style.position = 'relative';
    if (p.badge) card.append(h('span', { class: 'sc-badge cd-badge' }, [p.badge]));
    const imgWrap = h('div', { class: 'cd-imgwrap' });
    const productImg = img(p.imageUrl, p.title);
    if (productImg) imgWrap.append(productImg);
    card.append(imgWrap);
    card.append(h('div', { class: 'cd-title sc-title' }, [p.title]));
    const descriptor = p.subtitle ?? p.brand;
    if (descriptor) card.append(h('div', { class: 'cd-brand' }, [descriptor]));
    const price = h('div', { class: 'cd-price' }, [p.salePrice ?? p.price ?? '']);
    if (p.salePrice && p.price) price.append(h('span', { class: 'was' }, [p.price]));
    card.append(price);
    card.append(h('span', { class: 'sc-cta cd-cta' }, [meta.ctaLabel ?? 'Se produktet →']));
    card.setAttribute('aria-label', `${p.title} — ${meta.ctaLabel ?? 'se produktet'}`);
    tracker.observeProduct(card, p.id);
    track.append(card);
  }
  wrap.append(track);
  wrap.append(h('div', { class: 'cd-foot' }, [
    advertiser ? `Tilbud fra ${advertiser} · leveres af STEP Commerce` : 'Annonce · leveres af STEP Commerce',
  ]));
  root.append(wrap);
}
