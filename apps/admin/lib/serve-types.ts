// Mirror of packages/widget/src/types.ts — the /api/serve ↔ widget contract.
// Keep the two files in sync.

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
  imageRatio?: string;
  imageFit?: string;
  ctaStyle?: 'button' | 'link' | 'arrow';
  ctaPulse?: boolean;
  titleLineClamp?: number;
  customCss?: string;
}

export interface ServeProduct {
  id: string;
  title: string;
  clickUrl: string;
  imageUrl?: string;
  price?: string;
  salePrice?: string;
  brand?: string;
  subtitle?: string;
  reason?: string;
  matchScore?: number;
  badge?: string;
}

export type TemplateId =
  | 'forum_post'
  | 'recipe_section'
  | 'carousel'
  | 'grid'
  | 'stacked'
  | 'single_card';

export interface TemplateMeta {
  advertiserName: string;
  advertiserLogoUrl?: string;
  copy?: string;
  sponsoredLabel?: string;
  timestampLabel?: string;
  catalogTitle?: string;
  heroText?: string;
  contextProducts?: ServeProduct[];
  contextStripLabel?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  sectionHeading?: string;
  matchLine?: string;
  chips?: string[];
  bestMatchLabel?: string;
  whyLabel?: string;
  whyText?: string;
}

export interface TrackingConfig {
  endpoint: string;
  placementId: string;
  instanceId: string;
  advertiserId: string;
  siteId: string;
}

export interface ServeResponse {
  render: boolean;
  reason?: string;
  template?: TemplateId;
  tokens?: DesignTokens;
  products?: ServeProduct[];
  meta?: TemplateMeta;
  tracking?: TrackingConfig;
}
