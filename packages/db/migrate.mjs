// Applies schema.sql to the database in DATABASE_URL. Idempotent-ish: refuses
// to run if the advertiser table already exists (no migration framework in V1 —
// the schema is young enough to recreate; use `DROP_FIRST=1` to wipe and redo).
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = neon(url);

const [{ exists }] = await sql`
  select exists (
    select from information_schema.tables
    where table_schema = 'public' and table_name = 'advertiser'
  )`;

if (exists && process.env.DROP_FIRST !== '1') {
  console.error('Schema already applied (advertiser table exists). Set DROP_FIRST=1 to wipe and reapply.');
  process.exit(1);
}
if (exists) {
  console.log('Dropping public schema…');
  await sql`drop schema public cascade`;
  await sql`create schema public`;
}

const schema = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
await sql.transaction((tx) => [tx.unsafe(schema)]);
console.log('Schema applied.');
