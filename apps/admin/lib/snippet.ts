// Embed + GAM snippet generation. The publisher-facing output of the wizard:
// what the last step hands over is exactly this text.
import { BASE_PATH } from './base-path';

export function widgetOrigin(): string {
  // Includes the base path — snippets must point at .../stepcommerce/w.js.
  return process.env.WIDGET_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? `https://stepnetwork.dk${BASE_PATH}`;
}

export function embedSnippet(code: string): string {
  return `<script async src="${widgetOrigin()}/w.js"\n        data-placement="${code}"></script>`;
}

export function gamSnippet(code: string, kvKeys: string[]): string {
  const kv = kvKeys.map((k) => `      "${k}": "%%PATTERN:${k}%%"`).join(',\n');
  return `<script src="${widgetOrigin()}/w.js"></script>
<script>
  window.STEPCommerce && window.STEPCommerce.init({
    placement: "${code}",
    serveUrl: "${widgetOrigin()}/api/serve",
    clickMacro: "%%CLICK_URL_UNESC%%",
    kv: {
${kv}
    }
  });
</script>`;
}

/**
 * The GAM creative can only pass the keys we name in the macro list, so the
 * list must cover BOTH the placement's Level-A rule keys and every Level-B
 * targeting key of the instances behind it. A key missing here means the
 * creative resolves an instance and then matches no products at all.
 */
export function macroKeys(ruleKeys: string[], mappingKeys: string[]): string[] {
  return [...new Set([...ruleKeys, ...mappingKeys, 'limited_ads'].filter(Boolean))];
}

/** URL-safe placement code from a widget name: PLC_wine_pairing_madensverden. */
export function placementCode(name: string, suffix: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[æä]/g, 'ae').replace(/[øö]/g, 'oe').replace(/å/g, 'aa')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return `PLC_${slug || 'widget'}_${suffix}`;
}
