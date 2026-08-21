// Applies the schema baseline and then every pending migration in
// packages/db/migrations/, in version order, recording each in
// schema_migration. Safe to run repeatedly: already-applied versions are
// skipped, so this is the normal way to move an existing database forward.
//
//   DATABASE_URL=... npm run migrate -w @stepcommerce/db
//   DB_SCHEMA=public ...        # target a different schema
//   DROP_FIRST=1 ...            # wipe THIS schema only, then reapply
//
// In a shared database, run setup-shared-db.sql (as the DB owner) first.
import { neon } from '@neondatabase/serverless';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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
const here = dirname(fileURLToPath(import.meta.url));
const sql = neon(url);

const [{ exists }] = await sql`
  select exists (
    select from information_schema.tables
    where table_schema = ${schemaName} and table_name = 'advertiser'
  )`;

if (exists && process.env.DROP_FIRST === '1') {
  console.log(`Dropping schema "${schemaName}"…`);
  await sql.transaction((tx) => [tx.unsafe(`drop schema ${schemaName} cascade`)]);
}

const fresh = !exists || process.env.DROP_FIRST === '1';

if (fresh) {
  const ddl = readFileSync(join(here, 'schema.sql'), 'utf8');
  await sql.transaction((tx) => [
    tx.unsafe(`create schema if not exists ${schemaName}`),
    tx.unsafe(`set local search_path to ${schemaName}, public`),
    tx.unsafe(ddl),
  ]);
  console.log(`Baseline schema applied in "${schemaName}".`);
} else {
  // Older databases predate the bookkeeping table.
  await sql.transaction((tx) => [
    tx.unsafe(`set local search_path to ${schemaName}, public`),
    tx.unsafe(`create table if not exists schema_migration (
       version int primary key, name text not null,
       applied_at timestamptz not null default now())`),
    tx.unsafe(`insert into schema_migration (version, name) values (1, 'baseline')
       on conflict (version) do nothing`),
  ]);
}

const dir = join(here, 'migrations');
const files = existsSync(dir)
  ? readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort()
  : [];

const applied = new Set(
  (await sql`select version from schema_migration`).map((r) => Number(r.version)),
);

let count = 0;
for (const file of files) {
  const version = Number(file.split('_')[0]);
  if (applied.has(version)) continue;
  const ddl = readFileSync(join(dir, file), 'utf8');
  await sql.transaction((tx) => [
    tx.unsafe(`set local search_path to ${schemaName}, public`),
    tx.unsafe(ddl),
    tx.unsafe(
      `insert into schema_migration (version, name) values (${version}, '${file.replace(/'/g, "''")}')`,
    ),
  ]);
  console.log(`Applied ${file}`);
  count++;
}
console.log(count ? `${count} migration(s) applied.` : 'Schema up to date.');
