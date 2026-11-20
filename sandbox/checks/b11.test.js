'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { splitByWeights } = require('../src/rounding');
test('splitByWeights adds up', () => {
  assert.deepStrictEqual(splitByWeights(100, [1, 1, 1]), [34, 33, 33]);
  assert.deepStrictEqual(splitByWeights(10, [1, 2]), [3, 7]);
  assert.deepStrictEqual(splitByWeights(100, [1, 1]), [50, 50]);
  for (const [t, w] of [[999, [3, 5, 7]], [1, [1, 1, 1]], [0, [1, 2]]]) {
    assert.strictEqual(splitByWeights(t, w).reduce((a, b) => a + b, 0), t);
  }
});
