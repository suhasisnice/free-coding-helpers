'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { categorize, RULES } = require('../src/merchants');
const rules = require('../src/merchant-rules');
const known = [['Starbucks latte', 'food'], ['uber ride', 'transport'], ['Spotify family', 'fun'], ['March RENT', 'rent'], ['airtel bill', 'utilities'], ['xyz unknown', 'other'], ['hulu', 'fun'], ['shell fuel', 'transport']];

test('rules live in their own module', () => {
  assert.ok(Array.isArray(rules.RULES));
  assert.strictEqual(rules.RULES.length, 493);
  assert.deepStrictEqual(RULES, rules.RULES);
});
test('merchants.js no longer holds the table and requires it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'merchants.js'), 'utf8');
  assert.match(src, /require[(]'[.]\/merchant-rules'[)]/);
  assert.ok(src.length < 1500, 'merchants.js should now be small');
});
test('categorize still works', () => {
  for (const [text, cat] of known) assert.strictEqual(categorize(text), cat, text);
});
