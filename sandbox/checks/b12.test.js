'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseTags } = require('../src/tags');
test('parseTags drops empties', () => {
  assert.deepStrictEqual(parseTags(' , ,'), []);
  assert.deepStrictEqual(parseTags('a,,b'), ['a', 'b']);
  assert.deepStrictEqual(parseTags(' Food, fun ,,FOOD '), ['food', 'fun']);
  assert.deepStrictEqual(parseTags(''), []);
});
