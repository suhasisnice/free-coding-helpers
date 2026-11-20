'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { nextDue } = require('../src/recurring');
test('nextDue monthly clamps', () => {
  assert.strictEqual(nextDue('2026-01-31', 'monthly'), '2026-02-28');
  assert.strictEqual(nextDue('2028-01-31', 'monthly'), '2028-02-29');
  assert.strictEqual(nextDue('2026-03-31', 'monthly'), '2026-04-30');
  assert.strictEqual(nextDue('2026-12-15', 'monthly'), '2027-01-15');
  assert.strictEqual(nextDue('2026-01-05', 'weekly'), '2026-01-12');
  assert.throws(() => nextDue('2026-01-05', 'daily'));
});
