'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { percentOf } = require('../src/money');
test('percentOf', () => {
  assert.strictEqual(percentOf(1250, 10), 125);
  assert.strictEqual(percentOf(5, 50), 3);
  assert.strictEqual(percentOf(-5, 50), -3);
  assert.strictEqual(percentOf(999, 12.5), 125);
  assert.strictEqual(percentOf(1000, 100), 1000);
});
