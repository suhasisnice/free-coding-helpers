'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { totalsByMonth } = require('../src/report');

test('totalsByMonth keys are YYYY-MM', () => {
  assert.deepStrictEqual(totalsByMonth([
    { date: '2026-03-05', amount: 100 },
    { date: '2026-03-20', amount: 50 },
    { date: '2026-12-01', amount: 7 },
    { date: '2027-01-31', amount: 1 },
  ]), { '2026-03': 150, '2026-12': 7, '2027-01': 1 });
});
