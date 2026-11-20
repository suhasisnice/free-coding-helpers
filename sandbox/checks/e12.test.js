'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateExpense } = require('../src/validate');
const ok = { date: '2026-01-05', amount: 100, category: 'food', description: 'lunch' };
test('blank description rejected', () => {
  for (const d of ['', '   ']) {
    const r = validateExpense({ ...ok, description: d });
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.some((m) => /description/.test(m)));
  }
  assert.strictEqual(validateExpense(ok).ok, true);
});
