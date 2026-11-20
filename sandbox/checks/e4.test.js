'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseDate, formatDate } = require('../src/dates');

test("formatDate(d, 'long') spells out the month", () => {
  assert.strictEqual(formatDate(parseDate('2026-03-05'), 'long'), '5 March 2026');
  assert.strictEqual(formatDate(parseDate('2026-12-31'), 'long'), '31 December 2026');
  assert.strictEqual(formatDate(parseDate('2026-03-05')), '2026-03-05');
});
