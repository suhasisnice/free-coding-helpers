'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseAmount } = require('../src/money');

test('one decimal digit means tenths', () => {
  assert.strictEqual(parseAmount('12.5'), 1250);
  assert.strictEqual(parseAmount('0.5'), 50);
  assert.strictEqual(parseAmount('-2.5'), -250);
  assert.strictEqual(parseAmount('12.05'), 1205);
  assert.strictEqual(parseAmount('1,234.5'), 123450);
});
