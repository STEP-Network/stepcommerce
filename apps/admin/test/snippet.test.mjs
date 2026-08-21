// The snippets are the product's hand-over artefact: a missing macro key means
// the creative resolves a widget and then matches no products at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedSnippet, gamSnippet, macroKeys, placementCode } from './dist/snippet.js';

test('embed snippet references a placement, never an instance', () => {
  const s = embedSnippet('PLC_vin_madensverden');
  assert.match(s, /data-placement="PLC_vin_madensverden"/);
  assert.match(s, /w\.js/);
  assert.doesNotMatch(s, /instance/i);
});

test('GAM snippet carries every key as a PATTERN macro plus the click macro', () => {
  const s = gamSnippet('PLC_x', ['mv_cat', 'mv_ingredients', 'limited_ads']);
  for (const k of ['mv_cat', 'mv_ingredients', 'limited_ads']) {
    assert.match(s, new RegExp(`"${k}": "%%PATTERN:${k}%%"`));
  }
  assert.match(s, /%%CLICK_URL_UNESC%%/);
  assert.doesNotMatch(s, /googletag/, 'never read googletag from inside a SafeFrame');
});

test('macroKeys unions level A and level B keys and always includes limited_ads', () => {
  assert.deepEqual(macroKeys(['mv_page'], ['mv_ingredients', 'mv_page']),
    ['mv_page', 'mv_ingredients', 'limited_ads']);
  assert.deepEqual(macroKeys([], []), ['limited_ads']);
});

test('placement codes are URL-safe and transliterate Danish letters', () => {
  const code = placementCode('Vin til aftensmaden — Madens Verden (æøå)', 'ab12cd');
  assert.match(code, /^PLC_[A-Za-z0-9_-]+$/);
  assert.match(code, /aeoeaa/);
  assert.ok(code.endsWith('_ab12cd'));
});

test('an unusable name still produces a valid code', () => {
  assert.equal(placementCode('///', 'abcdef'), 'PLC_widget_abcdef');
});
