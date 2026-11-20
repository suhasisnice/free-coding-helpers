'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateExpense } = require('../src/validate');
const { checkBudgets } = require('../src/budget');

test("'health' is a valid category everywhere", () => {
  assert.ok(validateExpense({ date: '2026-03-01', amount: 100, category: 'health', description: 'dentist' }).ok);
  const rows = checkBudgets([{ date: '2026-03-01', amount: 900, category: 'health' }], { health: 1000 }, '2026-03');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].spent, 900);
});
