// Template B — "Native recipe section" (approved prototype: madensverden.dk × vin).
// The widget renders as one of the host site's own content sections: section
// header (icon + serif heading + hairline + chevron) with a quiet ANNONCE label,
// then a host-styled card with match line + ingredient chips, three product
// cards with animated match-score bars, and advertiser attribution.

import { h, link } from '../dom';
import type { ServeProduct, TemplateMeta } from '../types';
import type { Tracker } from '../track';

export const recipeCss = `
.rc-head{display:flex;align-items:center;gap:10px;margin:0 0 14px}
.rc-head svg{width:24px;height:24px;flex-shrink:0;opacity:.85}
.rc-head h2{font-size:1.45em;font-weight:500;color:var(--sc-text);white-space:nowrap}
.rc-head .rule{flex:1;height:1px;background:var(--sc-border)}
.rc-head .chev{color:var(--sc-text2);font-size:1em}
.rc-card{background:var(--sc-surface);border-radius:var(--sc-radius);padding:20px 26px 22px;box-shadow:var(--sc-shadow)}
.rc-match{font-size:.88em;color:var(--sc-text2);margin-bottom:16px}
.rc-match b{color:var(--sc-text)}
.rc-chip{display:inline-block;background:color-mix(in srgb,var(--sc-surface) 85%,var(--sc-border));border:1px solid var(--sc-border);border-radius:12px;padding:1px 10px;font-size:.78em;color:var(--sc-text2);margin:0 2px}
.rc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.rc-item{border:1px solid var(--sc-border);border-radius:calc(var(--sc-radius) - 2px);padding:16px 14px 14px;display:flex;flex-direction:column;align-items:center;text-align:center;background:var(--sc-surface);position:relative;transition:box-shadow .15s,transform .15s}
.rc-item:hover{box-shadow:0 4px 14px rgba(0,0,0,.12);transform:translateY(-2px)}
.rc-best{position:absolute;top:-9px;left:50%;transform:translateX(-50%);background:var(--sc-badge-bg);color:var(--sc-badge-text);font-size:.66em;letter-spacing:1px;border-radius:9px;padding:1px 10px;white-space:nowrap}
.rc-img{width:64px;height:110px;object-fit:var(--sc-img-fit);margin:4px 0 12px}
.rc-ph{width:30px;height:96px;position:relative;margin:6px 0 12px}
.rc-ph .n{position:absolute;top:0;left:50%;transform:translateX(-50%);width:9px;height:30px;border-radius:3px 3px 0 0;background:var(--sc-accent)}
.rc-ph .b{position:absolute;bottom:0;left:0;right:0;height:72px;border-radius:7px 7px 4px 4px;background:linear-gradient(170deg,var(--sc-accent2),var(--sc-accent))}
.rc-name{font-family:inherit;font-size:1em;color:var(--sc-text);line-height:1.3;font-weight:600}
.rc-sub{font-size:.78em;color:var(--sc-text2);margin:3px 0 8px}
.rc-mbar{width:100%;margin:2px 0 10px}
.rc-mbar .top{display:flex;justify-content:space-between;font-size:.68em;color:var(--sc-text2);margin-bottom:3px}
.rc-mbar .top b{color:var(--sc-badge-bg)}
.rc-mbar .track{height:5px;background:var(--sc-border);border-radius:3px;overflow:hidden}
.rc-mbar .fill{height:100%;background:linear-gradient(90deg,var(--sc-accent2),var(--sc-badge-bg));border-radius:3px;width:0;transition:width 1s ease .3s}
.rc-why{font-size:.75em;color:var(--sc-text2);min-height:32px;margin-bottom:10px}
.rc-price{font-size:1.1em;font-weight:700;color:var(--sc-price)}
.rc-price .was{font-size:.7em;color:var(--sc-text2);text-decoration:line-through;font-weight:400;margin-left:4px}
.rc-buy{margin-top:9px;width:100%;display:block;border-radius:calc(var(--sc-radius) - 3px);background:var(--sc-cta-bg);color:var(--sc-cta-text);font-size:.88em;font-weight:600;padding:9px 0;text-align:center;transition:filter .15s}
.rc-buy:hover{filter:brightness(.88)}
.rc-foot{display:flex;justify-content:space-between;align-items:center;margin-top:15px;font-size:.68em;color:var(--sc-text2);gap:8px;flex-wrap:wrap}
.rc-adv{display:flex;align-items:center;gap:6px}
.rc-adv img{height:16px}
.rc-advname{background:var(--sc-text);color:var(--sc-surface);font-size:.95em;letter-spacing:1.5px;padding:2px 8px;border-radius:2px;text-transform:uppercase}
.rc-why-toggle{cursor:pointer;text-decoration:underline;background:none;border:0;color:inherit;font:inherit}
.rc-whytext{display:none;margin-top:8px;font-size:.72em;color:var(--sc-text2)}
.rc-whytext.show{display:block}
@media (max-width:640px){.rc-grid{grid-template-columns:1fr}.rc-why{min-height:0}}
`;

const GLASS_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 3h8l-.6 6.2a3.4 3.4 0 0 1-6.8 0L8 3zM12 12.5V20M8.5 20h7"/></svg>';

function productCard(p: ServeProduct, isBest: boolean, meta: TemplateMeta, tracker: Tracker, wrapClick: (url: string) => string): HTMLElement {
  const card = h('div', { class: 'rc-item' });
  if (isBest) card.append(h('span', { class: 'rc-best' }, [meta.bestMatchLabel ?? 'Bedste match']));
  if (p.imageUrl) {
    card.append(h('img', { class: 'rc-img', src: p.imageUrl, alt: p.title, loading: 'lazy' }));
  } else {
    const ph = h('div', { class: 'rc-ph' });
    ph.append(h('div', { class: 'n' }), h('div', { class: 'b' }));
    card.append(ph);
  }
  card.append(h('div', { class: 'rc-name sc-title' }, [p.title]));
  if (p.subtitle) card.append(h('div', { class: 'rc-sub' }, [p.subtitle]));
  if (typeof p.matchScore === 'number') {
    const bar = h('div', { class: 'rc-mbar' });
    const top = h('div', { class: 'top' });
    top.append(h('span', undefined, ['Match til retten']), h('b', undefined, [`${Math.round(p.matchScore)}%`]));
    const track = h('div', { class: 'track' });
    const fill = h('div', { class: 'fill', 'data-w': `${Math.round(p.matchScore)}%` });
    track.append(fill);
    bar.append(top, track);
    card.append(bar);
  }
  if (p.reason) card.append(h('div', { class: 'rc-why' }, [p.reason]));
  const price = h('div', { class: 'rc-price' }, [p.salePrice ?? p.price ?? '']);
  if (p.salePrice && p.price) price.append(h('span', { class: 'was' }, [p.price]));
  card.append(price);
  card.append(link(wrapClick(p.clickUrl), 'rc-buy', ['Se produktet →']));
  tracker.observeProduct(card, p.id);
  return card;
}

export function renderRecipe(
  root: HTMLElement,
  products: ServeProduct[],
  meta: TemplateMeta,
  tracker: Tracker,
  wrapClick: (url: string) => string,
): void {
  const head = h('div', { class: 'rc-head' });
  const icon = h('span');
  icon.innerHTML = GLASS_ICON; // static SVG, never user data
  icon.style.color = 'inherit';
  icon.firstElementChild?.setAttribute('class', '');
  head.append(icon.firstElementChild ?? icon);
  head.append(
    h('h2', { class: 'sc-heading' }, [meta.sectionHeading ?? 'Udvalgt til dig']),
    h('span', { class: 'sc-annonce' }, ['Annonce']),
    h('div', { class: 'rule' }),
    h('span', { class: 'chev' }, ['⌄']),
  );
  root.append(head);

  const card = h('div', { class: 'rc-card' });
  if (meta.matchLine) {
    const line = h('div', { class: 'rc-match' }, [meta.matchLine + ' ']);
    for (const chip of meta.chips ?? []) line.append(h('span', { class: 'rc-chip' }, [chip]));
    card.append(line);
  }

  const grid = h('div', { class: 'rc-grid' });
  const bestIdx = products.reduce(
    (best, p, i) => ((p.matchScore ?? -1) > (products[best]?.matchScore ?? -1) ? i : best),
    0,
  );
  products.slice(0, 3).forEach((p, i) => grid.append(productCard(p, i === bestIdx && products.length > 1, meta, tracker, wrapClick)));
  card.append(grid);

  const foot = h('div', { class: 'rc-foot' });
  const adv = h('span', { class: 'rc-adv' }, ['Tilbud fra ']);
  if (meta.advertiserLogoUrl) adv.append(h('img', { src: meta.advertiserLogoUrl, alt: meta.advertiserName }));
  else adv.append(h('span', { class: 'rc-advname' }, [meta.advertiserName]));
  const whyBtn = h('button', { class: 'rc-why-toggle', type: 'button' }, [meta.whyLabel ?? 'Hvorfor ser jeg denne?']);
  const right = h('span', undefined, ['Annonce · leveres af STEP Commerce · ', whyBtn]);
  foot.append(adv, right);
  card.append(foot);

  const whyText = h('div', { class: 'rc-whytext' }, [
    meta.whyText ??
      'Anbefalingen er valgt ud fra sidens indhold (fx opskriftens ingredienser) — ikke ud fra dig. Vi bruger hverken cookies eller personlige oplysninger.',
  ]);
  card.append(whyText);
  whyBtn.addEventListener('click', () => whyText.classList.toggle('show'));

  root.append(card);

  // Animate match-score bars when the cards scroll into view — same
  // IntersectionObserver mechanic as viewability measurement.
  try {
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              (entry.target as HTMLElement).style.width = (entry.target as HTMLElement).dataset.w ?? '0';
              io.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.4 },
      );
      root.querySelectorAll('.rc-mbar .fill').forEach((f) => io.observe(f));
    }
  } catch {
    /* fail silent */
  }
}
