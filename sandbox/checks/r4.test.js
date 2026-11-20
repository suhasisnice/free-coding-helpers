'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { importCSV } = require('../src/importer');
const { run } = require('../src/cli');

const BAD = 'date,amount,category,description\n2026-03-01,1.00,food,ok\n2026-03-02,2.00,yachts,bad\n';

test('import errors are { line, message } objects', () => {
  const { errors } = importCSV(BAD);
  assert.strictEqual(typeof errors[0].line, 'number');
  assert.match(errors[0].message, /unknown category: yachts/);
  assert.ok(!/^line/.test(errors[0].message), 'message should not repeat the line prefix');
  assert.strictEqual(importCSV('x,y\n1,2\n').errors[0].line, 1);
});

test('cli still prints "line N: reason"', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-r4-')), 'in.csv');
  fs.writeFileSync(file, BAD);
  const items = [];
  const store = { add: (e) => { items.push(e); return e; }, save() {}, list: () => items };
  const lines = [];
  // trailing flag keeps this check independent of bug B2 (parseArgs drops the last word)
  run(['import', file, '--verbose'], { store, out: (l) => lines.push(l) });
  assert.ok(lines.some((l) => /^line \d+: unknown category: yachts$/.test(l)), lines.join(' | '));
  assert.ok(lines.includes('imported 1, rejected 1'));
});
