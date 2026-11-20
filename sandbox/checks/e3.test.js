'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { validateExpense } = require('../src/validate');

const base = { date: '2026-03-01', amount: 100, category: 'food' };

test('descriptions may be up to 140 characters', () => {
  assert.ok(validateExpense({ ...base, description: 'x'.repeat(140) }).ok);
  const r = validateExpense({ ...base, description: 'x'.repeat(141) });
  assert.ok(!r.ok);
  assert.match(r.errors.join(' '), /140/);
});
