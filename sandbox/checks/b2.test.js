'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseArgs } = require('../src/cli');

test('parseArgs keeps the last argument', () => {
  assert.deepStrictEqual(parseArgs(['add', '2026-03-05', '12.50', 'food', 'team', 'lunch']).args, ['2026-03-05', '12.50', 'food', 'team', 'lunch']);
  assert.deepStrictEqual(parseArgs(['list', '--all']).flags, { all: true });
  assert.deepStrictEqual(parseArgs(['list', '--category', 'food']).flags, { category: 'food' });
  assert.deepStrictEqual(parseArgs(['list', '--json', '--month', '2026-03']).flags, { json: true, month: '2026-03' });
});
