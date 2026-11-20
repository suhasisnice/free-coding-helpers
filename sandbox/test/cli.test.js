'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs, run } = require('../src/cli');

function memoryStore(items = []) {
  return {
    items,
    add(e) { const item = { id: items.length + 1, ...e }; items.push(item); return item; },
    list(f = {}) { return items.filter((x) => (!f.category || x.category === f.category) && (!f.month || x.date.startsWith(f.month))); },
    save() {},
  };
}

test('parseArgs reads a flag with a value', () => {
  assert.deepStrictEqual(parseArgs(['list', '--category', 'food']), { command: 'list', args: [], flags: { category: 'food' } });
});

test('add stores a valid expense', () => {
  const store = memoryStore();
  const lines = [];
  assert.strictEqual(run(['add', '2026-03-05', '12.50', 'food', 'lunch', 'with', 'team'], { store, out: (l) => lines.push(l) }), 0);
  assert.deepStrictEqual(lines, ['added #1 $12.50 food']);
});

test('list prints aligned rows', () => {
  const store = memoryStore([{ id: 1, date: '2026-03-05', amount: 1250, category: 'food', description: 'lunch' }]);
  const lines = [];
  run(['list', '--category', 'food'], { store, out: (l) => lines.push(l) });
  assert.deepStrictEqual(lines, ['#1   2026-03-05  $12.50     food       lunch']);
});

test('report prints the summary', () => {
  const store = memoryStore([{ id: 1, date: '2026-03-05', amount: 1250, category: 'food', description: 'lunch' }]);
  const lines = [];
  run(['report'], { store, out: (l) => lines.push(l) });
  assert.match(lines[0], /TOTAL\s+\$12\.50/);
});

test('unknown command prints usage', () => {
  const lines = [];
  assert.strictEqual(run(['nope'], { store: memoryStore(), out: (l) => lines.push(l) }), 2);
  assert.match(lines[0], /usage/);
});
