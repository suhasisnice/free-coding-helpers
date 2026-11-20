'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { categorize } = require('../src/merchants');
const known = [['Starbucks latte', 'food'], ['uber ride', 'transport'], ['Spotify family', 'fun'], ['March RENT', 'rent'], ['airtel bill', 'utilities'], ['xyz unknown', 'other'], ['hulu', 'fun'], ['shell fuel', 'transport']];

test('netflix is fun, in any case', () => {
  assert.strictEqual(categorize('Netflix monthly'), 'fun');
  assert.strictEqual(categorize('NETFLIX.COM'), 'fun');
});
test('other categories are unchanged', () => {
  for (const [text, cat] of known) assert.strictEqual(categorize(text), cat, text);
});
