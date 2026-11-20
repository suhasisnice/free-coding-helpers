'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/store');

test('store adds, filters and survives a save/load round trip', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-')), 'ledger.json');
  const s = createStore(file);
  s.load();
  s.add({ date: '2026-03-01', amount: 500, category: 'food', description: 'bagel' });
  s.add({ date: '2026-04-01', amount: 90000, category: 'rent', description: 'April' });
  assert.deepStrictEqual(s.list({ category: 'food' }).map((e) => e.id), [1]);
  assert.deepStrictEqual(s.list({ month: '2026-04' }).map((e) => e.description), ['April']);
  s.save();
  const again = createStore(file);
  assert.strictEqual(again.load().length, 2);
});
