'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { categorize } = require('../src/merchants');
const known = [['Starbucks latte', 'food'], ['uber ride', 'transport'], ['Spotify family', 'fun'], ['March RENT', 'rent'], ['airtel bill', 'utilities'], ['xyz unknown', 'other'], ['hulu', 'fun'], ['shell fuel', 'transport']];

test('zomato orders are food', () => {
  assert.strictEqual(categorize('ZOMATO order #44'), 'food');
});
test('existing categories are unchanged', () => {
  for (const [text, cat] of known) assert.strictEqual(categorize(text), cat, text);
});
