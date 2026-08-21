// Contract between /api/serve and the widget runtime. The server resolves
// everything (placement rules, KV mappings, fallback chain); the client only
// renders what it is handed. Keep this file in sync with apps/admin/lib/serve-types.ts.

export interface DesignTokens {
  colorBackground?: string;
  colorSurface?: string;
  colorText?: string;
  colorTextSecondary?: string;
  colorPrice?: string;
  colorCtaBg?: string;
  colorCtaText?: string;
  colorBorder?: string;
  colorAccent?: string;
  /** Secondary brand color, e.g. the light end of the tilbudsavis front-page gradient. */
  colorAccentSecondary?: string;
  colorBadgeBg?: string;
  colorBadgeText?: string;
  colorSplashBg?: string;
  colorSplashText?: string;
  fontFamily?: string;
  headingFontFamily?: string;
  fontSizeBase?: string;
  radius?: string;
  shadow?: string;
  imageRatio?: string;       // e.g. "1 / 1", "4 / 3"
  imageFit?: string;         // cover | contain
  ctaStyle?: 'button' | 'link' | 'arrow';
  ctaPulse?: boolean;
  titleLineClamp?: number;
  /** Scoped escape hatch, admin-only. Injected verbatim inside the shadow root. */
  customCss?: string;
}

export interface ServeProduct {
  id: string;
  title: string;
  /** First-party click redirect URL (/c/{product_id}?...) — never the raw destination. */
  clickUrl: string;
  imageUrl?: string;
  price?: string;            // preformatted, e.g. "89,95 kr."
  salePrice?: string;
  brand?: string;
  /** Secondary descriptor line, e.g. wine type/origin. */
  subtitle?: string;
  /** Template B: one-line pairing explanation ("derfor"). */
  reason?: string;
  /** Template B: 0–100 match score driving the score bar. */
  matchScore?: number;
  badge?: string;            // e.g. "Tilbud", "-20%"
}

export type TemplateId =
  | 'forum_post'
  | 'recipe_section'
  | 'carousel'
  | 'grid'
  | 'stacked'
  | 'single_card';

/** Template-specific presentation config resolved server-side from the instance. */
export interface TemplateMeta {
  advertiserName: string;
  advertiserLogoUrl?: string;
  /** Forum: conversational copy in the forum's voice. */
  copy?: string;
  /** Forum: badge label mirroring the forum's own badges. */
  sponsoredLabel?: string;
  timestampLabel?: string;
  /** Forum: offers for the flipping tilbudsavis (front + spreads built from products). */
  catalogTitle?: string;
  /** Forum: hero blurb on the tilbudsavis front page. */
  heroText?: string;
  /** Forum: 2–3 products for the "Relevant for denne tråd" strip. */
  contextProducts?: ServeProduct[];
  contextStripLabel?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** Recipe: heading of the native section. */
  sectionHeading?: string;
  /** Recipe: plain-Danish explanation of the selection. */
  matchLine?: string;
  /** Recipe: ingredient chips shown after the match line. */
  chips?: string[];
  bestMatchLabel?: string;
  whyLabel?: string;
  whyText?: string;
}

export interface TrackingConfig {
  /** Absolute base, e.g. https://widgets.stepnetwork.dk — events POST to {base}/api/events. */
  endpoint: string;
  placementId: string;
  instanceId: string;
  advertiserId: string;
  siteId: string;
}

export interface ServeResponse {
  render: boolean;
  reason?: string;           // when render=false: 'no_rule_match' | 'stale_feed' | 'no_products' | ...
  template?: TemplateId;
  tokens?: DesignTokens;
  products?: ServeProduct[];
  meta?: TemplateMeta;
  tracking?: TrackingConfig;
}

export interface WidgetConfig {
  placement: string;
  /** Explicit KVs (GAM %%PATTERN%% injection). Merged over collected page KVs. */
  kv?: Record<string, string>;
  /** Page KV keys to read from googletag/dataLayer. Server may not need hints; harmless to omit. */
  kvKeys?: string[];
  serveUrl?: string;
  /** GAM %%CLICK_URL_UNESC%% — prepended to click URLs for GAM click parity. */
  clickMacro?: string;
  /** Container to render into. Defaults to a div inserted after the script tag. */
  container?: HTMLElement;
  /** Playground: GET this JSON instead of POSTing to /api/serve. */
  mockUrl?: string;
}
