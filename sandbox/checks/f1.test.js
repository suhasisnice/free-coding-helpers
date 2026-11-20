'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { run } = require('../src/cli');
const { importCSV } = require('../src/importer');

test('export prints re-importable CSV', () => {
  const items = [
    { id: 1, date: '2026-03-05', amount: 123456, category: 'rent', description: 'March, flat "A"' },
    { id: 2, date: '2026-03-06', amount: 5, category: 'food', description: 'gum' },
  ];
  const store = { list: () => items, add() {}, save() {} };
  const lines = [];
  assert.strictEqual(run(['export'], { store, out: (l) => lines.push(l) }), 0);
  const text = lines.join('\n');
  assert.strictEqual(text.split(/\r?\n/)[0], 'date,amount,category,description');
  assert.match(text, /1234\.56/);
  assert.ok(!text.includes('$'));
  const back = importCSV(text);
  assert.deepStrictEqual(back.errors, []);
  assert.deepStrictEqual(back.expenses, items.map(({ id, ...e }) => e));
});
