import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchSegments, segmentTerms } from './dist/dict.js';

// The production dictionary shipped in packages/db/seed.mjs.
const DICT = {
  skinkeschnitzler: 'svinekød', skinke: 'svinekød', flæsk: 'svinekød', nakkefilet: 'svinekød',
  svinemørbrad: 'svinekød', svinekød: 'svinekød', bacon: 'svinekød', frikadelle: 'svinekød',
  pancetta: 'svinekød', kotelet: 'svinekød',
  oksemørbrad: 'oksekød', oksekød: 'oksekød', entrecote: 'oksekød', culotte: 'oksekød',
  oksesteg: 'oksekød', hakkebøf: 'oksekød', oksebøf: 'oksekød', ribeye: 'oksekød',
  'bøf': { segment: 'oksekød', match: 'exact' },
  kylling: 'fjerkræ', kalkun: 'fjerkræ', andebryst: 'fjerkræ', andelår: 'fjerkræ',
  andesteg: 'fjerkræ', 'and': { segment: 'fjerkræ', match: 'exact' },
  torsk: 'fisk', laks: 'fisk', rødspætte: 'fisk', rejer: 'fisk', muslinger: 'fisk',
  tun: 'fisk', sild: 'fisk', hummer: 'fisk',
  pasta: 'pasta', spaghetti: 'pasta', lasagne: 'pasta', tagliatelle: 'pasta', risotto: 'pasta',
};

const segments = (value) => [...matchSegments(DICT, value).keys()].sort();

test('the real production key-value resolves to svinekød', () => {
  // Captured from GAM on madensverden.dk (spec §14).
  const mv = 'skinkeschnitzler, salt og friskkværnet peber, rosmarin, Fanø skinke, hvedemel';
  assert.deepEqual(segments(mv), ['svinekød']);
  // Compound matching is the point: "skinke" matches inside "skinkeschnitzler"
  // and inside "Fanø skinke", and the chip shows the most specific term.
  assert.deepEqual(segmentTerms(matchSegments(DICT, mv), 'svinekød'), ['skinkeschnitzler']);
});

test('short terms do not match inside unrelated Danish words', () => {
  // Regression: unanchored substring matching made "and" (duck) match "vand"
  // (water), "koriander" and "mandler", so salmon and cake recipes were served
  // a poultry red with the visible chip "and".
  assert.deepEqual(segments('laks, vand, salt, dild, citron'), ['fisk']);
  assert.deepEqual(segments('torsk, koriander, kokosmælk, chili'), ['fisk']);
  assert.deepEqual(segments('mandler, sukker, æg, marcipan, vand'), []);
  assert.deepEqual(segments('spinat, hvidløg, olivenolie, vand, salt'), []);
  assert.deepEqual(segments('bøffelmozzarella, tomat, basilikum'), []);
  assert.deepEqual(segments('brandy, fløde, sukker'), []);
});

test('genuine short-word and compound matches still work', () => {
  assert.deepEqual(segments('andebryst, timian, kartofler'), ['fjerkræ']);
  assert.deepEqual(segments('and, æbler, svesker'), ['fjerkræ']);
  assert.deepEqual(segments('hakkebøf, løg, brun sovs'), ['oksekød']);
  assert.deepEqual(segments('bøf, pommes frites'), ['oksekød']);
  assert.deepEqual(segments('kyllingebryst, karry'), ['fjerkræ']); // prefix "kylling"
  assert.deepEqual(segments('pastaskruer, pesto'), ['pasta']);
});

test('multi-segment pages report every segment they matched', () => {
  assert.deepEqual(segments('laks, bacon, dild'), ['fisk', 'svinekød']);
});

test('chips are ordered as the recipe lists them and never leak another segment', () => {
  const bySegment = matchSegments(DICT, 'bacon, laks, dild');
  assert.deepEqual(segmentTerms(bySegment, 'fisk'), ['laks']);
  assert.deepEqual(segmentTerms(bySegment, 'svinekød'), ['bacon']);
  // Asking for a segment that did not match must not return another's terms.
  assert.equal(segmentTerms(bySegment, 'fjerkræ'), null);
});

test('matching is case- and unicode-normalisation-insensitive', () => {
  assert.deepEqual(segments('LAKS, Dild'), ['fisk']);

  // A segment NAME looked up in decomposed form must resolve too — that is what
  // kv_mapping.segment holds, so a mismatch silently serves nothing.
  const bySegment = matchSegments(DICT, 'andebryst, timian');
  assert.deepEqual(segmentTerms(bySegment, 'fjerkr\u00e6'), ['andebryst']);
  assert.deepEqual(segmentTerms(bySegment, 'fjerkrae'.replace('ae', '\u00e6')), ['andebryst']);

  // A page value written with a decomposed vowel still matches a composed term.
  const decomposed = 'andela\u0301r'.normalize('NFD');
  assert.equal(matchSegments({ andel: 'fjerkr\u00e6' }, decomposed).size, 1);
});

test('separators other than comma are tokenised', () => {
  assert.deepEqual(segments('laks · dild · citron'), ['fisk']);
  assert.deepEqual(segments('laks; dild'), ['fisk']);
});

test('empty and malformed dictionaries are safe', () => {
  assert.equal(matchSegments({}, 'laks').size, 0);
  assert.equal(matchSegments({ '': 'fisk' }, 'laks').size, 0);
  assert.equal(matchSegments({ laks: { match: 'exact' } }, 'laks').size, 0); // no segment
  assert.equal(matchSegments(undefined, 'laks').size, 0);
});

test('regex metacharacters in a term cannot break matching', () => {
  const dict = { 'a+b(c)': 'test' };
  assert.equal(matchSegments(dict, 'a+b(c), salt').size, 1);
  assert.equal(matchSegments(dict, 'aaab, salt').size, 0);
});
