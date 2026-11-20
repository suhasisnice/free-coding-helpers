'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateExpense } = require('../src/validate');
const ok = { date: '2026-01-05', amount: 100, category: 'food', description: 'lunch' };
test('impossible dates rejected', () => {
  for (const d of ['2026-02-30', '2026-13-01', '2026-00-10']) {
    const r = validateExpense({ ...ok, date: d });
    assert.strictEqual(r.ok, false);
    assert.ok(r.errors.includes('date must be YYYY-MM-DD'));
  }
  assert.strictEqual(validateExpense({ ...ok, date: '2028-02-29' }).ok, true);
  assert.strictEqual(validateExpense(ok).ok, true);
});
