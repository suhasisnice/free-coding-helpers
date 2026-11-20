'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { groupSum } = require('../src/group');
const report = require('../src/report');
test('groupSum', () => {
  assert.deepStrictEqual(groupSum([{ k: 'a', v: 1 }, { k: 'b', v: 5 }, { k: 'a', v: 2 }], (x) => x.k, (x) => x.v), { a: 3, b: 5 });
  assert.deepStrictEqual(groupSum([], (x) => x, (x) => x), {});
});
test('report uses it', () => {
  const ex = [{ date: '2026-03-02', category: 'food', amount: 100 }, { date: '2026-03-09', category: 'food', amount: 50 }, { date: '2026-03-10', category: 'rent', amount: 900 }];
  assert.deepStrictEqual(report.totalsByCategory(ex), { food: 150, rent: 900 });
  assert.ok(/require\(['"]\.\/group['"]\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'report.js'), 'utf8')));
});
