'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { formatCents } = require('../src/money');

test('formatCents supports EUR, GBP and INR', () => {
  assert.strictEqual(formatCents(1250, 'EUR'), '€12.50');
  assert.strictEqual(formatCents(123456, 'GBP'), '£1,234.56');
  assert.strictEqual(formatCents(-500, 'INR'), '-₹5.00');
  assert.strictEqual(formatCents(1250), '$12.50');
  assert.throws(() => formatCents(1, 'XYZ'));
});
