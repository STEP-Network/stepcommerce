// Design tokens → CSS custom properties inside the shadow root (spec §6).
// Tokens are the only styling contract; templates consume the variables.

import type { DesignTokens } from './types';

const DEFAULTS: Required<Omit<DesignTokens, 'customCss' | 'ctaPulse'>> & { ctaPulse: boolean } = {
  colorBackground: 'transparent',
  colorSurface: '#ffffff',
  colorText: '#1a1a1a',
  colorTextSecondary: '#6b7280',
  colorPrice: '#1a1a1a',
  colorCtaBg: '#1a1a1a',
  colorCtaText: '#ffffff',
  colorBorder: '#e5e7eb',
  colorAccent: '#5F46D2',
  colorAccentSecondary: '#8b78e0',
  colorBadgeBg: '#5F46D2',
  colorBadgeText: '#ffffff',
  fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  headingFontFamily: 'inherit',
  fontSizeBase: '15px',
  radius: '8px',
  shadow: '0 1px 3px rgba(0,0,0,.08)',
  imageRatio: '1 / 1',
  imageFit: 'cover',
  ctaStyle: 'button',
  ctaPulse: false,
  titleLineClamp: 2,
};

export function resolveTokens(tokens?: DesignTokens): DesignTokens {
  return { ...DEFAULTS, ...(tokens ?? {}) };
}

export function tokenCss(t: DesignTokens): string {
  return `:host{all:initial;display:block;contain:content}
.sc-root{
  --sc-bg:${t.colorBackground};--sc-surface:${t.colorSurface};--sc-text:${t.colorText};
  --sc-text2:${t.colorTextSecondary};--sc-price:${t.colorPrice};--sc-cta-bg:${t.colorCtaBg};
  --sc-cta-text:${t.colorCtaText};--sc-border:${t.colorBorder};--sc-accent:${t.colorAccent};
  --sc-badge-bg:${t.colorBadgeBg};--sc-badge-text:${t.colorBadgeText};--sc-accent2:${t.colorAccentSecondary};
  --sc-radius:${t.radius};--sc-shadow:${t.shadow};--sc-img-ratio:${t.imageRatio};
  --sc-img-fit:${t.imageFit};
  font-family:${t.fontFamily};font-size:${t.fontSizeBase};color:var(--sc-text);
  background:var(--sc-bg);line-height:1.45;box-sizing:border-box;
}
.sc-root *,.sc-root *::before,.sc-root *::after{box-sizing:inherit;margin:0;padding:0}
.sc-root img{max-width:100%;display:block}
.sc-root a{color:inherit;text-decoration:none}
.sc-heading{font-family:${t.headingFontFamily}}
.sc-title{display:-webkit-box;-webkit-line-clamp:${t.titleLineClamp};-webkit-box-orient:vertical;overflow:hidden}
.sc-cta{display:inline-flex;align-items:center;gap:.4em;background:var(--sc-cta-bg);color:var(--sc-cta-text);
  border-radius:var(--sc-radius);padding:.55em 1.1em;font-weight:600;cursor:pointer;border:0;font-size:.95em}
.sc-cta--link{background:none;color:var(--sc-accent);padding:0;border-radius:0;text-decoration:underline}
.sc-cta--pulse{animation:sc-pulse 2.2s ease-in-out infinite}
@keyframes sc-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
.sc-badge{display:inline-block;background:var(--sc-badge-bg);color:var(--sc-badge-text);
  border-radius:999px;padding:.15em .7em;font-size:.72em;font-weight:700}
.sc-annonce{font-size:.62em;letter-spacing:.14em;text-transform:uppercase;color:var(--sc-text2);opacity:.75}
@media (prefers-reduced-motion:reduce){
  .sc-root *,.sc-root *::before,.sc-root *::after{animation:none!important;transition:none!important}
}
${t.customCss ?? ''}`;
}
