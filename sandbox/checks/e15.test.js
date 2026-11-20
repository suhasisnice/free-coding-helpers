'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkBudgets } = require('../src/budget');
const ex = [{ date: '2026-03-02', category: 'food', amount: 5000 }];
test('custom alert ratio', () => {
  const rows = (r) => checkBudgets(ex, { food: 10000 }, '2026-03', r)[0];
  assert.strictEqual(rows().alert, false);
  assert.strictEqual(rows(0.5).alert, true);
  assert.strictEqual(rows(0.6).alert, false);
});
