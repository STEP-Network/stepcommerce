// The style probe decides what the model sees. These tests pin the extraction
// rules, which is the part that can silently degrade without an API key in play.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractStyleHints, relevantCss } from './dist/ai-style.js';

const PAGE = `<!doctype html><html><head>
  <title>Kylling i fad — Madens Verden</title>
  <meta name="theme-color" content="#7a1f3d">
  <link rel="stylesheet" href="/assets/site.css">
  <link rel="preload stylesheet" href="https://cdn.example.com/fonts.css">
  <link rel="icon" href="/favicon.ico">
  <style>:root{--brand:#7a1f3d}body{font-family:"Merriweather",Georgia,serif;color:#241f1c}</style>
</head><body>…</body></html>`;

test('title, theme colour and inline CSS are picked up', () => {
  const h = extractStyleHints(PAGE, 'https://madensverden.dk/opskrift/kylling');
  assert.equal(h.title, 'Kylling i fad — Madens Verden');
  assert.match(h.inline, /--brand:#7a1f3d/);
  assert.match(h.inline, /theme-color/, 'meta theme-color is carried as a CSS custom property');
  assert.match(h.inline, /#7a1f3d/);
});

test('stylesheet hrefs are resolved absolutely and non-stylesheets ignored', () => {
  const h = extractStyleHints(PAGE, 'https://madensverden.dk/opskrift/kylling');
  assert.deepEqual(h.stylesheets, [
    'https://madensverden.dk/assets/site.css',
    'https://cdn.example.com/fonts.css',
  ]);
});

test('a page with no CSS at all yields empty inline, not a crash', () => {
  const h = extractStyleHints('<html><body>hi</body></html>', 'https://x.dk/');
  assert.equal(h.inline, '');
  assert.deepEqual(h.stylesheets, []);
  assert.equal(h.title, 'https://x.dk/');
});

test('relevantCss keeps colour/font/shape rules and drops layout-only ones', () => {
  const css = `
    .grid { display: grid; gap: 12px }
    .card { background: #fff; border-radius: 10px }
    .t { font-family: Inter, sans-serif }
    .hidden { display: none }
    .btn { box-shadow: 0 1px 2px rgba(0,0,0,.2) }
  `;
  const out = relevantCss(css);
  assert.match(out, /\.card/);
  assert.match(out, /\.t /);
  assert.match(out, /\.btn/);
  assert.doesNotMatch(out, /\.grid/);
  assert.doesNotMatch(out, /\.hidden/);
});

test('relevantCss falls back to raw CSS rather than sending nothing', () => {
  const out = relevantCss('.grid { display: grid }');
  assert.match(out, /display: grid/);
});

test('relevantCss respects the size limit', () => {
  const css = Array.from({ length: 500 }, (_, i) => `.c${i} { color: #123456 }`).join('\n');
  assert.ok(relevantCss(css, 200).length <= 200);
});
