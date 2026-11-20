'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { titleCase } = require('../src/text');
test('titleCase', () => {
  assert.strictEqual(titleCase('hello wORLD'), 'Hello World');
  assert.strictEqual(titleCase('  a   b '), 'A B');
  assert.strictEqual(titleCase(''), '');
  assert.strictEqual(titleCase('ELECTRIC bill'), 'Electric Bill');
});
