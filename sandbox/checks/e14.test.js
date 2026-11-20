'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { toCSV } = require('../src/csv');
test('toCSV eol option', () => {
  assert.strictEqual(toCSV([['a', 'b'], ['c', 'd']], { eol: '\r\n' }), 'a,b\r\nc,d\r\n');
  assert.strictEqual(toCSV([['a', 'b'], ['c', 'd']]), 'a,b\nc,d\n');
  assert.strictEqual(toCSV([['x,y', 'z']], { eol: '\r\n' }), '"x,y",z\r\n');
});
