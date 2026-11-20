'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { formatDate } = require('../src/dates');
test('formatDate invalid', () => {
  assert.throws(() => formatDate(new Date('nonsense')), (e) => e instanceof Error && !(e instanceof RangeError) && /invalid date/.test(e.message));
  assert.strictEqual(formatDate(new Date(Date.UTC(2026, 0, 5))), '2026-01-05');
});
