// Key-value acquisition for the direct embed (spec §5): googletag page-level
// targeting → dataLayer → data-kv attribute. GAM-served creatives never reach
// this path — their KVs arrive pre-injected via %%PATTERN%% macros in config.kv,
// and probing googletag from inside a SafeFrame is explicitly forbidden.

type Googletag = {
  apiReady?: boolean;
  pubads?: () => {
    getTargetingKeys?: () => string[];
    getTargeting?: (key: string) => string[];
  };
};

/** Drops empty values and unexpanded GAM macros so the server sees an absent key. */
function usable(value: string | undefined): boolean {
  return !!value && !/^%%.*%%$/.test(value);
}

function fromGoogletag(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const gt = (window as { googletag?: Googletag }).googletag;
    if (!gt || !gt.apiReady || !gt.pubads) return out;
    const pubads = gt.pubads();
    const keys = pubads.getTargetingKeys ? pubads.getTargetingKeys() : [];
    for (const key of keys) {
      const values = pubads.getTargeting ? pubads.getTargeting(key) : [];
      if (values && values.length) out[key] = values.join(',');
    }
  } catch {
    /* fail silent */
  }
  return out;
}

function fromDataLayer(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const dl = (window as { dataLayer?: unknown[] }).dataLayer;
    if (!Array.isArray(dl)) return out;
    for (const entry of dl) {
      if (!entry || typeof entry !== 'object') continue;
      for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
        if (typeof value === 'string' || typeof value === 'number') out[key] = String(value);
        else if (Array.isArray(value) && value.every((v) => typeof v === 'string')) {
          out[key] = value.join(',');
        }
      }
    }
  } catch {
    /* fail silent */
  }
  return out;
}

function fromScriptAttr(script: HTMLElement | null): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const raw = script?.getAttribute('data-kv');
    if (!raw) return out;
    // Format: "key=value;key2=value2" — publisher-hardcoded final fallback.
    for (const pair of raw.split(';')) {
      const idx = pair.indexOf('=');
      if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
    }
  } catch {
    /* fail silent */
  }
  return out;
}

/**
 * Later sources win: googletag < dataLayer < data-kv < explicit config KVs.
 *
 * When explicit KVs are supplied (the GAM path) the page is NOT probed at all:
 * inside a SafeFrame `window.googletag` is the iframe's own window, and reading
 * publisher targeting from there is exactly what CLAUDE.md rule 3 forbids.
 */
export function collectKv(
  script: HTMLElement | null,
  explicit?: Record<string, string>,
): Record<string, string> {
  const merged = explicit
    ? { ...fromScriptAttr(script), ...explicit }
    : { ...fromGoogletag(), ...fromDataLayer(), ...fromScriptAttr(script) };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) if (usable(v)) out[k] = v;
  return out;
}

/**
 * Device class. Inside a GAM SafeFrame `innerWidth` is the CREATIVE's width, so
 * a 300x250 slot on a desktop would report "mobile" and misattribute essentially
 * all network traffic. Use the screen width whenever we are framed.
 */
export function deviceClass(): string {
  try {
    const framed = window !== window.top;
    const w = (framed ? window.screen?.width : window.innerWidth) || window.innerWidth || 0;
    return w >= 1024 ? 'desktop' : w >= 600 ? 'tablet' : 'mobile';
  } catch {
    // Cross-origin access to window.top throws in some browsers — that itself
    // means we are framed, so fall back to the screen width.
    try {
      const w = window.screen?.width || 0;
      return w >= 1024 ? 'desktop' : w >= 600 ? 'tablet' : 'mobile';
    } catch {
      return 'unknown';
    }
  }
}
