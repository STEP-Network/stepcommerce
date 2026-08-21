// Pure dictionary matching for multi-value key-values (spec §14).
//
// This is the logic that decides which products a page gets, so it is kept
// dependency-free and unit-tested: a false positive here puts the wrong
// advertiser's product on a publisher page with a plain-Danish claim that it
// matched the content.

/** Dictionary entry: "term": "segment", or {"segment": …, "match": "exact"|"prefix"}. */
export type DictEntry = string | { segment: string; match?: 'exact' | 'prefix' };
export type DictEntries = Record<string, DictEntry>;

/** Lowercase + NFC + underscore-normalise, applied to BOTH sides of a compare. */
export function norm(value: string): string {
  return value.toLowerCase().normalize('NFC').replace(/_/g, ' ');
}

export function tokenize(value: string): string[] {
  return norm(value)
    .split(/[,;·|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matching is anchored at a WORD START inside each token, never a bare
 * substring: "skinke" must still match "skinkeschnitzler" and "Fanø skinke"
 * (Danish compounds are the whole point of the dictionary), but "and" (duck)
 * must not match "vand" (water), "koriander" or "mandler". Terms of three
 * characters or fewer default to whole-word matching, because a 3-letter
 * prefix collides with far too many Danish words.
 */
export function termMatches(needle: string, mode: 'exact' | 'prefix', tokens: string[]): boolean {
  const pattern = mode === 'exact'
    ? new RegExp(`(^|\\s)${escapeRe(needle)}($|\\s)`, 'u')
    : new RegExp(`(^|\\s)${escapeRe(needle)}`, 'u');
  return tokens.some((t) => pattern.test(t));
}

/**
 * Returns matched terms grouped BY SEGMENT. Grouping matters: the terms become
 * the widget's visible ingredient chips, so a flat list made the widget name an
 * ingredient it had not matched on.
 */
export function matchSegments(entries: DictEntries, pageValue: string): Map<string, string[]> {
  const tokens = tokenize(pageValue);
  const bySegment = new Map<string, string[]>();
  for (const [term, raw] of Object.entries(entries ?? {})) {
    const entry = typeof raw === 'string' ? { segment: raw } : raw;
    if (!entry?.segment) continue;
    const needle = norm(term).trim();
    if (!needle) continue;
    const mode = entry.match ?? (needle.length <= 3 ? 'exact' : 'prefix');
    if (termMatches(needle, mode, tokens)) {
      const list = bySegment.get(entry.segment) ?? [];
      list.push(needle);
      bySegment.set(entry.segment, list);
    }
  }
  // Chips are shown to readers: order them as the recipe lists them, and drop a
  // term that is only a prefix of another matched term, so the widget shows
  // "skinkeschnitzler" rather than both "skinke" and "skinkeschnitzler".
  const haystack = norm(pageValue);
  for (const [segment, list] of bySegment) {
    const specific = list.filter((t) => !list.some((other) => other !== t && other.startsWith(t)));
    specific.sort((a, b) => haystack.indexOf(a) - haystack.indexOf(b));
    bySegment.set(segment, specific);
  }
  return bySegment;
}

/** Looks up one segment, comparing normalised so decomposed å still matches. */
export function segmentTerms(bySegment: Map<string, string[]>, segment: string): string[] | null {
  const target = norm(segment).trim();
  for (const [key, terms] of bySegment) {
    if (norm(key).trim() === target) return terms;
  }
  return null;
}
