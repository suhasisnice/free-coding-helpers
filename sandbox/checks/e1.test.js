'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { truncate } = require('../src/text');

test('truncate uses a single ellipsis character', () => {
  assert.strictEqual(truncate('abcdefghij', 5), 'abcd…');
  assert.strictEqual(truncate('abc', 5), 'abc');
  for (let max = 1; max < 12; max++) assert.ok(truncate('abcdefghijkl', max).length <= max);
});
