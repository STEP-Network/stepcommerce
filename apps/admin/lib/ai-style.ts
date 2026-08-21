// AI styling: point at a publisher page, add a screenshot of roughly where the
// widget goes, and get design tokens that make the widget look like it belongs
// on that page in that spot.
//
// Two inputs, deliberately: the page's real CSS gives exact hex values and font
// stacks (a screenshot only gives rendered pixels, and JPEG-ish colour is not a
// brand colour), while the screenshot gives the surrounding layout — column
// width, card style, how loud the section around the slot is.
import Anthropic from '@anthropic-ai/sdk';
import { validateFeedUrl } from './feed';
import type { DesignTokens } from './serve-types';

const MODEL = 'claude-opus-5';
const FETCH_TIMEOUT_MS = 15_000;
const MAX_CSS_CHARS = 60_000;

export interface StyleSuggestion {
  tokens: DesignTokens;
  layout?: string;
  rationale: string;
  palette: string[];
  fonts: string[];
}

/** The token fields the model may set. Anything else is not a styling decision. */
const TOKEN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    colorBackground: { type: 'string' },
    colorSurface: { type: 'string' },
    colorText: { type: 'string' },
    colorTextSecondary: { type: 'string' },
    colorPrice: { type: 'string' },
    colorCtaBg: { type: 'string' },
    colorCtaText: { type: 'string' },
    colorBorder: { type: 'string' },
    colorAccent: { type: 'string' },
    colorBadgeBg: { type: 'string' },
    colorBadgeText: { type: 'string' },
    fontFamily: { type: 'string' },
    headingFontFamily: { type: 'string' },
    fontSizeBase: { type: 'string' },
    radius: { type: 'string' },
    shadow: { type: 'string' },
    imageRatio: { type: 'string' },
    ctaStyle: { type: 'string', enum: ['button', 'link', 'arrow'] },
    titleLineClamp: { type: 'integer', minimum: 1, maximum: 4 },
  },
  required: [
    'colorBackground', 'colorSurface', 'colorText', 'colorTextSecondary', 'colorPrice',
    'colorCtaBg', 'colorCtaText', 'colorBorder', 'colorAccent', 'fontFamily',
    'headingFontFamily', 'fontSizeBase', 'radius', 'ctaStyle',
  ],
} as const;

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tokens: TOKEN_SCHEMA,
    layout: {
      type: 'string',
      enum: ['recipe_section', 'carousel', 'grid', 'stacked', 'single_card', 'forum_post'],
    },
    palette: { type: 'array', items: { type: 'string' }, maxItems: 8 },
    fonts: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    rationale: { type: 'string' },
  },
  required: ['tokens', 'layout', 'palette', 'fonts', 'rationale'],
} as const;

/**
 * Pulls what a page declares about its own look, without fetching anything:
 * the inline <style> blocks, the theme colour, the title, and the URLs of the
 * linked stylesheets. Separated out so it can be tested against fixtures — the
 * regexes here decide what the model gets to see.
 */
export function extractStyleHints(html: string, pageUrl: string): {
  inline: string;
  title: string;
  stylesheets: string[];
} {
  const title = /<title[^>]*>([^<]{1,200})</i.exec(html)?.[1]?.trim() ?? pageUrl;
  const parts: string[] = [];
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) parts.push(m[1]);
  const theme = /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)/i.exec(html)?.[1];
  if (theme) parts.push(`/* meta theme-color */ :root { --theme-color: ${theme} }`);

  const stylesheets: string[] = [];
  for (const m of html.matchAll(/<link[^>]+>/gi)) {
    if (!/rel=["'][^"']*stylesheet/i.test(m[0])) continue;
    const href = /href=["']([^"']+)/i.exec(m[0])?.[1];
    if (!href) continue;
    try {
      stylesheets.push(new URL(href, pageUrl).toString());
    } catch {
      // A malformed href is not worth failing the whole analysis over.
    }
  }
  return { inline: parts.join('\n'), title, stylesheets };
}

/**
 * Keeps the payload small AND useful: colour, font and shape declarations are
 * what a design decision rests on; the rest of a 200 KB framework build is
 * noise that would crowd out the parts that matter.
 */
export function relevantCss(css: string, limit = MAX_CSS_CHARS): string {
  const picked = [...css.matchAll(/[^{}]*\{[^{}]*(?:color|background|font|border-radius|box-shadow)[^{}]*\}/gi)]
    .map((m) => m[0].trim())
    .join('\n');
  return (picked || css).slice(0, limit);
}

/** Fetches the page and its stylesheets. Best-effort: a page we cannot read
 *  still gets styled from the screenshot alone. */
export async function fetchPageStyles(pageUrl: string): Promise<{ css: string; title: string; notes: string[] }> {
  const notes: string[] = [];
  const check = validateFeedUrl(pageUrl);
  if (!check.ok) throw new Error(`URL afvist: ${check.reason}`);

  const res = await fetch(pageUrl, {
    headers: { 'user-agent': 'STEPCommerce-StyleProbe/1.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Kunne ikke hente siden: HTTP ${res.status}`);
  const html = (await res.text()).slice(0, 900_000);

  const hints = extractStyleHints(html, pageUrl);
  const parts = [hints.inline];
  for (const href of hints.stylesheets.slice(0, 3)) {
    try {
      const sheet = await fetch(href, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (sheet.ok) parts.push(`/* ${href} */\n${(await sheet.text()).slice(0, 200_000)}`);
    } catch {
      notes.push(`Kunne ikke hente stylesheet: ${href}`);
    }
  }
  const joined = parts.filter(Boolean).join('\n');
  if (!joined) notes.push('Ingen CSS fundet — styling bygger kun på screenshottet.');

  return { css: relevantCss(joined), title: hints.title, notes };
}

const SYSTEM = `Du er senior UI-designer på STEP Commerce, en dansk platform for kontekstuelle commerce-widgets.
Din opgave: foreslå design-tokens så en produkt-widget ser ud som en naturlig del af den side og det område,
brugeren peger på — ikke som en bannerannonce.

Regler:
- Tokens skal være konkrete CSS-værdier (hex til farver, komplette font-stacks med fallback, px/rem til mål).
- Brug sidens FAKTISKE farver og fonte fra den medsendte CSS. Screenshottet fortæller dig hvilke af dem der
  gælder netop det område widgetten skal ligge i (baggrundsfarve bag slotten, kortstil, kantrunding, luft).
- Widgetten er altid tydeligt annoncemærket, og mærkningen er hard-coded. Design ikke omkring den, og forsøg
  ikke at nedtone den.
- Læsbarhed slår mimicry: mindst 4.5:1 kontrast mellem colorText og colorSurface.
- Vælg layout ud fra pladsen i screenshottet: smal sidebar → stacked eller single_card, bred spalte i en
  artikel → recipe_section eller carousel, gitterområde → grid, stor brandflade → forum_post.
- rationale: 2-4 sætninger på dansk om hvad du læste af siden, og hvorfor tokens ser ud som de gør.`;

export async function suggestStyle(input: {
  pageUrl: string;
  screenshot?: { mediaType: string; base64: string };
  areaNote?: string;
  widgetType: string;
}): Promise<StyleSuggestion & { notes: string[] }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY er ikke sat — AI-styling er ikke tilgængelig i dette miljø.');
  }
  const { css, title, notes } = await fetchPageStyles(input.pageUrl);

  const content: Anthropic.ContentBlockParam[] = [];
  if (input.screenshot) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: input.screenshot.mediaType as 'image/png',
        data: input.screenshot.base64,
      },
    });
    content.push({
      type: 'text',
      text: 'Screenshottet ovenfor viser siden. Widgetten skal ligge i det område brugeren beskriver nedenfor.',
    });
  }
  content.push({
    type: 'text',
    text: [
      `Side: ${input.pageUrl}`,
      `Sidetitel: ${title}`,
      `Widget-type: ${input.widgetType === 'takeover' ? 'takeover/brandflade' : 'produkt-matching (feed-drevet)'}`,
      input.areaNote ? `Placering ifølge brugeren: ${input.areaNote}` : 'Placering: ikke angivet — antag hovedspalten.',
      '',
      'Sidens CSS (uddrag med farve-, font- og form-deklarationer):',
      '```css',
      css || '/* ingen CSS tilgængelig */',
      '```',
    ].join('\n'),
  });

  const client = new Anthropic();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: 'user', content }],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  let parsed: StyleSuggestion;
  try {
    parsed = JSON.parse(text) as StyleSuggestion;
  } catch {
    throw new Error('Modellen svarede ikke med gyldig JSON. Prøv igen.');
  }
  return { ...parsed, notes };
}
