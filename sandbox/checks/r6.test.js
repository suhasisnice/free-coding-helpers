'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { matchesFilter } = require('../src/filters');
const { createStore } = require('../src/store');
test('filters module', () => {
  const it = { date: '2026-03-02', category: 'food' };
  assert.strictEqual(matchesFilter(it, {}), true);
  assert.strictEqual(matchesFilter(it, { category: 'food' }), true);
  assert.strictEqual(matchesFilter(it, { category: 'rent' }), false);
  assert.strictEqual(matchesFilter(it, { month: '2026-03' }), true);
  assert.strictEqual(matchesFilter(it, { month: '2026-04' }), false);
  assert.strictEqual(matchesFilter(it, { month: '2026-03', category: 'rent' }), false);
});
test('store uses it and still lists', () => {
  const s = createStore(path.join(os.tmpdir(), 'r6-' + process.pid + '.json'));
  s.add({ date: '2026-03-02', category: 'food', amount: 1 }); s.add({ date: '2026-04-02', category: 'rent', amount: 2 });
  assert.strictEqual(s.list({ month: '2026-03' }).length, 1);
  assert.strictEqual(s.list({}).length, 2);
  assert.ok(/require\(['"]\.\/filters['"]\)/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'store.js'), 'utf8')));
});
