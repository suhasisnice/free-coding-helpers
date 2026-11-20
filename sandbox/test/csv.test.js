'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCSV } = require('../src/csv');

test('parseCSV splits simple rows', () => {
  assert.deepStrictEqual(parseCSV('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('parseCSV keeps commas and escaped quotes inside quoted fields', () => {
  assert.deepStrictEqual(parseCSV('"x, y","say ""hi"""\n'), [['x, y', 'say "hi"']]);
});

test('parseCSV accepts CRLF and a missing final newline', () => {
  assert.deepStrictEqual(parseCSV('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
});
