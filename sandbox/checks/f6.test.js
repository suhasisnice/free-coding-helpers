'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateAll } = require('../src/validate');
const ok = { date: '2026-01-05', amount: 100, category: 'food', description: 'lunch' };
test('validateAll', () => {
  assert.deepStrictEqual(validateAll([]), []);
  assert.deepStrictEqual(validateAll([ok, ok]), []);
  const r = validateAll([ok, { ...ok, amount: -1 }, ok, { ...ok, category: 'zzz' }]);
  assert.deepStrictEqual(r.map((x) => x.index), [1, 3]);
  assert.ok(r.every((x) => Array.isArray(x.errors) && x.errors.length >= 1));
});
