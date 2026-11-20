'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const money = require('../src/money');

test('parseAmount is renamed to toCents everywhere', () => {
  assert.strictEqual(typeof money.toCents, 'function');
  assert.strictEqual(money.parseAmount, undefined);
  assert.strictEqual(money.toCents('$1,234.56'), 123456);
  for (const dir of ['src', 'test']) {
    for (const f of fs.readdirSync(path.join(__dirname, '..', dir))) {
      const text = fs.readFileSync(path.join(__dirname, '..', dir, f), 'utf8');
      assert.ok(!text.includes('parseAmount'), dir + '/' + f + ' still mentions parseAmount');
    }
  }
});
