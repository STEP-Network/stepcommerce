// Neon Postgres access. `sql` is the tagged-template client for static queries;
// `query` runs parameterized text for dynamically built SQL (rules engine).
// The client is created lazily so `next build` succeeds without DATABASE_URL.
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

let client: NeonQueryFunction<false, false> | null = null;

function db(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    client = neon(url);
  }
  return client;
}

export const sql = (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]> =>
  db()(strings, ...values) as Promise<Record<string, unknown>[]>;

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  return (await db().query(text, params)) as T[];
}
