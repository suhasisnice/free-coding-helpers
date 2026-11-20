'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAmount, formatCents } = require('../src/money');

test('parseAmount reads plain, grouped and dollar-prefixed amounts', () => {
  assert.strictEqual(parseAmount('12.50'), 1250);
  assert.strictEqual(parseAmount('1,234.56'), 123456);
  assert.strictEqual(parseAmount('$8'), 800);
  assert.strictEqual(parseAmount('-3.25'), -325);
});

test('parseAmount rejects garbage', () => {
  assert.throws(() => parseAmount('abc'), /invalid amount/);
  assert.throws(() => parseAmount('1.234'), /invalid amount/);
});

test('formatCents groups thousands and handles negatives', () => {
  assert.strictEqual(formatCents(123456), '$1,234.56');
  assert.strictEqual(formatCents(-500), '-$5.00');
  assert.strictEqual(formatCents(7), '$0.07');
});
