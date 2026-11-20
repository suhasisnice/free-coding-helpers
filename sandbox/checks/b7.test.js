'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { median, mean } = require('../src/stats');
test('median', () => {
  assert.strictEqual(median([1, 2, 3, 4]), 2.5);
  assert.strictEqual(median([4, 1, 3, 2]), 2.5);
  assert.strictEqual(median([5, 1, 3]), 3);
  assert.strictEqual(median([7]), 7);
  assert.strictEqual(median([]), 0);
  const a = [3, 1, 2]; median(a); assert.deepStrictEqual(a, [3, 1, 2]);
  assert.strictEqual(mean([1, 2, 3]), 2);
});
