'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { run } = require('../src/cli');

test('list --json prints one JSON array', () => {
  const items = [
    { id: 1, date: '2026-03-05', amount: 1250, category: 'food', description: 'lunch' },
    { id: 2, date: '2026-03-06', amount: 90000, category: 'rent', description: 'March' },
  ];
  const store = { list: (f = {}) => items.filter((x) => !f.category || x.category === f.category) };
  const lines = [];
  run(['list', '--json', '--category', 'food'], { store, out: (l) => lines.push(l) });
  assert.strictEqual(lines.length, 1);
  assert.deepStrictEqual(JSON.parse(lines[0]), [items[0]]);
});
