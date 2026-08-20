// Builds the widget bundle and enforces the 30 KB gzip budget (spec §7).
// Output: dist/w.js (stable alias) — deploys should also publish an immutable
// versioned copy (w.{hash}.js) and point the alias at it.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const BUDGET_GZIP = 30 * 1024;

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/loader.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: ['es2020'],
  outfile: 'dist/w.js',
  legalComments: 'none',
});

const raw = readFileSync('dist/w.js');
const gz = gzipSync(raw, { level: 9 });
writeFileSync('dist/w.js.gz', gz);
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log(`w.js: ${kb(raw.length)} raw, ${kb(gz.length)} gzip (budget ${kb(BUDGET_GZIP)})`);
if (gz.length > BUDGET_GZIP) {
  console.error('FAIL: bundle exceeds the 30 KB gzip budget');
  process.exit(1);
}
