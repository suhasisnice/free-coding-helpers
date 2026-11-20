'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');

test('remove deletes only the one expense', () => {
  const s = createStore(path.join(os.tmpdir(), 'ledger-b5-unused.json'));
  for (const d of ['a', 'b', 'c']) s.add({ date: '2026-03-01', amount: 1, category: 'food', description: d });
  assert.strictEqual(s.remove(2), true);
  assert.deepStrictEqual(s.list().map((x) => x.description), ['a', 'c']);
  assert.strictEqual(s.remove(99), false);
  assert.strictEqual(s.list().length, 2);
});
