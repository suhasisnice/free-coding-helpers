'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { addMonths, parseDate, formatDate } = require('../src/dates');
const f = (s, n) => formatDate(addMonths(parseDate(s), n));
test('addMonths', () => {
  assert.strictEqual(f('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(f('2028-01-31', 1), '2028-02-29');
  assert.strictEqual(f('2026-03-31', -1), '2026-02-28');
  assert.strictEqual(f('2026-11-15', 3), '2027-02-15');
  assert.strictEqual(f('2026-01-15', -2), '2025-11-15');
  assert.strictEqual(f('2026-05-10', 0), '2026-05-10');
});
