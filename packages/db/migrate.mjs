// Applies schema.sql into the target schema (default: stepcommerce, override
// with DB_SCHEMA=public for a dedicated database). Refuses to run if the
// advertiser table already exists there; DROP_FIRST=1 drops just that schema
// and reapplies — other schemas in a shared database are never touched.
// In a shared database, run setup-shared-db.sql (as the DB owner) first.
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const schemaName = process.env.DB_SCHEMA ?? 'stepcommerce';
if (!/^[a-z_][a-z0-9_]*$/.test(schemaName)) {
  console.error(`Invalid DB_SCHEMA: ${schemaName}`);
  process.exit(1);
}
const sql = neon(url);

const [{ exists }] = await sql`
  select exists (
    select from information_schema.tables
    where table_schema = ${schemaName} and table_name = 'advertiser'
  )`;

if (exists && process.env.DROP_FIRST !== '1') {
  console.error(`Schema already applied (${schemaName}.advertiser exists). Set DROP_FIRST=1 to wipe and reapply.`);
  process.exit(1);
}

const ddl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
await sql.transaction((tx) => [
  ...(exists ? [tx.unsafe(`drop schema ${schemaName} cascade`)] : []),
  tx.unsafe(`create schema if not exists ${schemaName}`),
  tx.unsafe(`set local search_path to ${schemaName}, public`),
  tx.unsafe(ddl),
]);
console.log(`Schema applied in "${schemaName}".`);
