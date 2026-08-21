import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileRule } from './dist/rules.js';

test('compiles nested all/any with correct parameter offsets', () => {
  // The offset contract is load-bearing: resolveProducts passes
  // [feed_id, limit, advertiser_id, ...ruleParams], so rule placeholders must
  // start at $4. A mismatch binds the wrong values silently.
  const { where, params } = compileRule(
    {
      all: [
        { field: 'custom_label_0', operator: 'contains', value: 'svinekød' },
        { field: 'availability', operator: 'equals', value: 'in stock' },
        { any: [{ field: 'price', operator: 'lt', value: 150 }, { field: 'sale_price', operator: 'exists' }] },
      ],
    },
    3,
  );
  assert.match(where, /custom_label_0 ilike \$4/);
  assert.match(where, /availability = \$5/);
  assert.match(where, /price_amount < \$6::numeric/);
  assert.match(where, /sale_price_amount is not null/);
  assert.deepEqual(params, ['%svinekød%', 'in stock', '150']);
});

test('rejects an unknown field (blocks SQL injection through the JSONB)', () => {
  assert.throws(() => compileRule([{ field: 'title; drop table product--', operator: 'equals', value: 'x' }]));
  assert.throws(() => compileRule([{ field: '"; delete from feed; --', operator: 'exists' }]));
});

test('rejects an empty group instead of compiling it to `true`', () => {
  // `true` would make the rule match the entire feed, serving the whole
  // catalogue on any page.
  assert.throws(() => compileRule({ all: [] }), /Empty rule group/);
  assert.throws(() => compileRule({ any: [] }), /Empty rule group/);
  assert.throws(() => compileRule([]), /Empty rule group/);
  assert.throws(
    () => compileRule({ any: [{ field: 'brand', operator: 'exists' }, { all: [] }] }),
    /Empty rule group/,
  );
});

test('gt/lt are restricted to numeric fields and numeric values', () => {
  // `title > $1::numeric` would type-error at SERVE time, where the throw is
  // swallowed and the widget just goes dark.
  assert.throws(() => compileRule([{ field: 'title', operator: 'gt', value: '5' }]), /numeric fields/);
  assert.throws(() => compileRule([{ field: 'price', operator: 'gt', value: 'abc' }]), /numeric value/);
  assert.doesNotThrow(() => compileRule([{ field: 'price', operator: 'gt', value: 99.5 }]));
});

test('contains is rejected on numeric fields', () => {
  assert.throws(() => compileRule([{ field: 'price', operator: 'contains', value: '9' }]));
});

test('in operator binds an array', () => {
  const { where, params } = compileRule([{ field: 'brand', operator: 'in', value: ['A', 'B'] }]);
  assert.match(where, /brand = any\(\$1\)/);
  assert.deepEqual(params, [['A', 'B']]);
});
