'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAmount } = require('../src/money');
test('parseAmount negatives', () => {
  assert.strictEqual(parseAmount('-$5.00'), -500);
  assert.strictEqual(parseAmount('(12.50)'), -1250);
  assert.strictEqual(parseAmount('($1,000)'), -100000);
  assert.strictEqual(parseAmount('$8'), 800);
  assert.strictEqual(parseAmount('-3'), -300);
  assert.throws(() => parseAmount('abc'));
  assert.throws(() => parseAmount('1.234'));
});
