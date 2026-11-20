'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkBudgets } = require('../src/budget');

const expenses = [
  { date: '2026-03-01', amount: 500, category: 'Food' },
  { date: '2026-03-02', amount: 300, category: 'food' },
  { date: '2026-02-02', amount: 999, category: 'food' },
];

test('budget categories match regardless of case', () => {
  assert.strictEqual(checkBudgets(expenses, { food: 1000 }, '2026-03')[0].spent, 800);
  assert.strictEqual(checkBudgets(expenses, { Food: 1000 }, '2026-03')[0].spent, 800);
  assert.strictEqual(checkBudgets(expenses, { food: 1000 }, '2026-03')[0].alert, true);
});
