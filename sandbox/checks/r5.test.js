'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const csv = require('../src/csv');
test('quote renamed to quoteField', () => {
  assert.strictEqual(typeof csv.quoteField, 'function');
  assert.strictEqual(csv.quoteField('a,b'), '"a,b"');
  assert.strictEqual(csv.quoteField(null), '');
  assert.strictEqual(csv.toCSV([['a', 'b,c']]), 'a,"b,c"\n');
  assert.deepStrictEqual(csv.parseCSV('a,"b,c"\n'), [['a', 'b,c']]);
  assert.ok(!/\bquote\b/.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'csv.js'), 'utf8')));
});
