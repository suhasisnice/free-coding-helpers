'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { summarize } = require('../src/report');

test('summarize orders categories by total, largest first', () => {
  const out = summarize([
    { date: '2026-03-01', amount: 100, category: 'food' },
    { date: '2026-03-01', amount: 90000, category: 'rent' },
    { date: '2026-03-01', amount: 100, category: 'fun' },
    { date: '2026-03-01', amount: 5000, category: 'transport' },
  ]);
  assert.deepStrictEqual(out.split('\n').map((l) => l.split(/\s+/)[0]), ['rent', 'transport', 'food', 'fun', 'TOTAL']);
});
