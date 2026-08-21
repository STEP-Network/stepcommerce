// Mounts a resolved ServeResponse into a Shadow DOM root and wires tracking.
// Publisher CSS cannot reach inside; widget CSS cannot leak out (spec §6).

import { forumCss, renderForum } from './templates/forum';
import { recipeCss, renderRecipe } from './templates/recipe';
import { cardsCss, renderCards } from './templates/cards';
import { resolveTokens, tokenCss } from './tokens';
import { Tracker } from './track';
import { h, safeUrl } from './dom';
import type { ServeResponse } from './types';

/** Returns false when nothing was rendered, so the caller can drop the container. */
export function mount(
  container: HTMLElement,
  serve: ServeResponse,
  kv: Record<string, string>,
  device: string,
  clickMacro?: string,
): boolean {
  // Validate the whole payload BEFORE attaching a shadow root: a half-valid
  // payload used to throw after attachShadow, leaving an empty shadow-attached
  // div on the publisher's page forever.
  if (
    !serve.render || !serve.template || !serve.products?.length ||
    !serve.meta?.advertiserName || !serve.tracking?.endpoint
  ) {
    return false;
  }
  const tokens = resolveTokens(serve.tokens);
  const shadow = container.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = tokenCss(tokens) + forumCss + recipeCss + cardsCss;
  shadow.append(style);

  // Marks the ad boundary for assistive tech so it can be skipped as a unit.
  const root = h('div', { class: 'sc-root', role: 'complementary', 'aria-label': 'Annonce' });
  shadow.append(root);

  const tracker = new Tracker(serve.tracking, kv, device);
  // An unexpanded %%CLICK_URL_UNESC%% would turn every href into a relative URL
  // and 404 on the publisher's own domain, so only a real absolute prefix is used.
  const prefix = safeUrl(clickMacro) ? clickMacro : undefined;
  const wrapClick = (url: string): string => (prefix ? prefix + url : url);

  switch (serve.template) {
    case 'forum_post':
      renderForum(root, serve.products, serve.meta, tracker, wrapClick);
      break;
    case 'recipe_section':
      renderRecipe(root, serve.products, serve.meta, tracker, wrapClick);
      break;
    default:
      renderCards(root, serve.template, serve.products, serve.meta, tracker, wrapClick);
  }

  if (tokens.ctaPulse) root.querySelectorAll('.sc-cta').forEach((el) => el.classList.add('sc-cta--pulse'));
  if (tokens.ctaStyle === 'link') root.querySelectorAll('.sc-cta').forEach((el) => el.classList.add('sc-cta--link'));

  tracker.send('load');
  tracker.observeViewable(root);
  return true;
}
