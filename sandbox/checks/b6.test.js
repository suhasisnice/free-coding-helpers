'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { importCSV } = require('../src/importer');

test('errors carry the real file line number', () => {
  const r = importCSV('date,amount,category,description\n2026-03-01,1.00,food,ok\n2026-03-02,2.00,yachts,bad\n');
  assert.match(String(r.errors[0]), /^line 3: /);
  const r2 = importCSV('date,amount,category,description\n\n2026-03-01,1.00,food,ok\nnot-a-date,2.00,food,bad\n');
  assert.match(String(r2.errors[0]), /^line 4: /);
});
