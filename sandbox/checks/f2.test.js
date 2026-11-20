'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { averageByCategory } = require('../src/report');

test('averageByCategory rounds to the cent', () => {
  assert.deepStrictEqual(averageByCategory([
    { date: '2026-03-01', amount: 100, category: 'food' },
    { date: '2026-03-02', amount: 201, category: 'food' },
    { date: '2026-03-02', amount: 90000, category: 'rent' },
  ]), { food: 151, rent: 90000 });
  assert.deepStrictEqual(averageByCategory([]), {});
});
