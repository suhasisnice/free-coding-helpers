'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('categories live in one module', () => {
  const { CATEGORIES } = require('../src/categories');
  assert.deepStrictEqual(CATEGORIES, ['food', 'rent', 'transport', 'utilities', 'fun', 'other']);
  assert.deepStrictEqual(require('../src/validate').CATEGORIES, CATEGORIES);
  for (const f of ['validate.js', 'budget.js']) {
    assert.match(src(f), /require\(['"]\.\/categories(\.js)?['"]\)/, f);
    assert.ok(!/'rent'|"rent"/.test(src(f)), f + ' still has its own list');
  }
  assert.ok(require('../src/validate').validateExpense({ date: '2026-03-01', amount: 1, category: 'rent', description: '' }).ok);
  assert.strictEqual(require('../src/budget').checkBudgets([], { rent: 100 }, '2026-03').length, 1);
});
