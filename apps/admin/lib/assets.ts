// Logo/asset storage. Advertiser logos are small PNG/SVG/JPEG files that must
// survive a redeploy and be reachable from a publisher page, so they live as
// bytea rows in Postgres and are served by /api/asset/{id} — no external blob
// store, no filesystem (serverless functions have none).
import { query } from './db';
import { basePathUrl } from './base-path';

/** Kept small on purpose: a logo is a logo. Anything bigger is a mistake. */
export const MAX_ASSET_BYTES = 512 * 1024;

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']);

export function assetUrl(id: string | null | undefined): string | undefined {
  return id ? basePathUrl(`/api/asset/${id}`) : undefined;
}

/**
 * Stores an uploaded file and returns its asset id, or null when the form field
 * was empty. Throws with a human-readable message on type/size violations so
 * the caller can show it instead of a 500.
 */
export async function storeUpload(file: unknown): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!ALLOWED.has(file.type)) {
    throw new Error(`Filtypen ${file.type || 'ukendt'} understøttes ikke — brug PNG, JPEG, WEBP, GIF eller SVG.`);
  }
  if (file.size > MAX_ASSET_BYTES) {
    throw new Error(`Filen er ${Math.round(file.size / 1024)} KB — grænsen er ${MAX_ASSET_BYTES / 1024} KB.`);
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  const rows = await query<{ id: string }>(
    `insert into asset (filename, content_type, bytes, byte_size)
     values ($1, $2, $3, $4) returning id`,
    [file.name || 'upload', file.type, bytes, bytes.length],
  );
  return rows[0]?.id ?? null;
}
