'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { totalsByCategory, summarize } = require('../src/report');

const expenses = [
  { date: '2026-03-01', amount: 3000, category: 'fun', description: 'cinema' },
  { date: '2026-03-02', amount: 2000, category: 'fun', description: 'bowling' },
  { date: '2026-03-03', amount: 250, category: 'other', description: 'stamps' },
];

test('totalsByCategory sums per category', () => {
  assert.deepStrictEqual(totalsByCategory(expenses), { fun: 5000, other: 250 });
});

test('summarize prints one padded line per category and a total', () => {
  assert.strictEqual(summarize(expenses), [
    'fun         $50.00',
    'other       $2.50',
    'TOTAL       $52.50',
  ].join('\n'));
});
