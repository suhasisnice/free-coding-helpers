'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { importCSV } = require('../src/importer');

test('importCSV turns valid rows into expenses', () => {
  const { expenses, errors } = importCSV(
    'date,amount,category,description\n2026-03-01,12.50,Food,lunch\n2026-03-02,"1,200.00",rent,"March, flat"\n');
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(expenses, [
    { date: '2026-03-01', amount: 1250, category: 'food', description: 'lunch' },
    { date: '2026-03-02', amount: 120000, category: 'rent', description: 'March, flat' },
  ]);
});

test('importCSV skips invalid rows and reports them', () => {
  const { expenses, errors } = importCSV(
    'date,amount,category,description\n2026-03-01,12.50,food,lunch\n2026-03-02,9.99,yachts,oops\n');
  assert.strictEqual(expenses.length, 1);
  assert.strictEqual(errors.length, 1);
  assert.match(errors[0], /unknown category: yachts/);
});

test('importCSV rejects a file with the wrong header', () => {
  const { expenses, errors } = importCSV('when,how much\n2026-03-01,5\n');
  assert.deepStrictEqual(expenses, []);
  assert.match(errors[0], /expected header/);
});
