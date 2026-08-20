// Key-value acquisition for the direct embed (spec §5): googletag page-level
// targeting → dataLayer → data-kv attribute. GAM-served creatives never reach
// this path — their KVs arrive pre-injected via %%PATTERN%% macros in config.kv.

type Googletag = {
  apiReady?: boolean;
  pubads?: () => {
    getTargetingKeys?: () => string[];
    getTargeting?: (key: string) => string[];
  };
};

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

/** Later sources win: googletag < dataLayer < data-kv < explicit config KVs. */
export function collectKv(
  script: HTMLElement | null,
  explicit?: Record<string, string>,
): Record<string, string> {
  return { ...fromGoogletag(), ...fromDataLayer(), ...fromScriptAttr(script), ...(explicit ?? {}) };
}

export function deviceClass(): string {
  try {
    const w = window.innerWidth || 0;
    return w >= 1024 ? 'desktop' : w >= 600 ? 'tablet' : 'mobile';
  } catch {
    return 'unknown';
  }
}
