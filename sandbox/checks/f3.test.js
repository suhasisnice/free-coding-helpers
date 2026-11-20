'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { forecast } = require('../src/budget');

test('forecast projects month-end spend linearly', () => {
  const expenses = [
    { date: '2026-03-02', amount: 1000, category: 'food' },
    { date: '2026-03-10', amount: 2000, category: 'food' },
    { date: '2026-03-15', amount: 500, category: 'food' },
    { date: '2026-02-20', amount: 999, category: 'food' },
  ];
  const rows = forecast(expenses, { food: 9000, fun: 5000 }, '2026-03-10');
  assert.deepStrictEqual(rows.find((r) => r.category === 'food'), { category: 'food', spent: 3000, projected: 9300, limit: 9000, over: true });
  assert.deepStrictEqual(rows.find((r) => r.category === 'fun'), { category: 'fun', spent: 0, projected: 0, limit: 5000, over: false });
  assert.strictEqual(forecast([{ date: '2026-02-14', amount: 1400, category: 'food' }], { food: 1 }, '2026-02-14')[0].projected, 2800);
});
