'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { searchExpenses } = require('../src/search');
const items = [{ id: 1, description: 'Coffee beans' }, { id: 2, description: 'rent' }, { id: 3, description: 'COFFEE shop' }];
test('search ignores case', () => {
  assert.deepStrictEqual(searchExpenses(items, 'coffee').map((e) => e.id), [1, 3]);
  assert.deepStrictEqual(searchExpenses(items, '  RENT ').map((e) => e.id), [2]);
  assert.deepStrictEqual(searchExpenses(items, ''), []);
  assert.deepStrictEqual(searchExpenses(items, 'zzz'), []);
});
