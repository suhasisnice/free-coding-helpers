'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseCSV } = require('../src/csv');

test('parseCSV accepts a delimiter option', () => {
  assert.deepStrictEqual(parseCSV('a;b\n"x;y";2\n', { delimiter: ';' }), [['a', 'b'], ['x;y', '2']]);
  assert.deepStrictEqual(parseCSV('a,b\n1,2\n'), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(parseCSV('a,b;c\n', { delimiter: ';' }), [['a,b', 'c']]);
});
