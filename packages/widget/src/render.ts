// Mounts a resolved ServeResponse into a Shadow DOM root and wires tracking.
// Publisher CSS cannot reach inside; widget CSS cannot leak out (spec §6).

import { forumCss, renderForum } from './templates/forum';
import { recipeCss, renderRecipe } from './templates/recipe';
import { cardsCss, renderCards } from './templates/cards';
import { resolveTokens, tokenCss } from './tokens';
import { Tracker } from './track';
import { h } from './dom';
import type { ServeResponse } from './types';

export function mount(
  container: HTMLElement,
  serve: ServeResponse,
  kv: Record<string, string>,
  device: string,
  clickMacro?: string,
): void {
  if (!serve.render || !serve.template || !serve.tracking || !serve.products?.length || !serve.meta) {
    return; // fallback chain ended in "render nothing" — collapse gracefully
  }
  const tokens = resolveTokens(serve.tokens);
  const shadow = container.attachShadow({ mode: 'closed' });

  const style = document.createElement('style');
  style.textContent = tokenCss(tokens) + forumCss + recipeCss + cardsCss;
  shadow.append(style);

  const root = h('div', { class: 'sc-root' });
  shadow.append(root);

  const tracker = new Tracker(serve.tracking, kv, device);
  const wrapClick = (url: string): string => (clickMacro ? clickMacro + url : url);

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
}
