// Bundles the pure library modules for testing, stubbing the DB layer so unit
// tests need no database. Run via `npm test -w admin`.
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');
mkdirSync(out, { recursive: true });

const stubPath = join(out, 'db-stub.mjs');
writeFileSync(
  stubPath,
  `export const sql = () => { throw new Error('db not available in unit tests'); };
   export const query = () => { throw new Error('db not available in unit tests'); };`,
);

await build({
  entryPoints: [
    join(here, '..', 'lib', 'rules.ts'),
    join(here, '..', 'lib', 'feed.ts'),
    join(here, '..', 'lib', 'dict.ts'),
  ],
  outdir: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  plugins: [
    {
      name: 'db-stub',
      setup(b) {
        b.onResolve({ filter: /^\.\/db$/ }, () => ({ path: stubPath }));
      },
    },
  ],
});
