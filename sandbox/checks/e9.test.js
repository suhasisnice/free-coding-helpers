'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { plural } = require('../src/text');
test('plural endings', () => {
  assert.strictEqual(plural(2, 'category'), '2 categories');
  assert.strictEqual(plural(2, 'box'), '2 boxes');
  assert.strictEqual(plural(2, 'church'), '2 churches');
  assert.strictEqual(plural(2, 'bus'), '2 buses');
  assert.strictEqual(plural(2, 'day'), '2 days');
  assert.strictEqual(plural(1, 'category'), '1 category');
  assert.strictEqual(plural(0, 'expense'), '0 expenses');
});
