'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('pad helper is shared from text.js', () => {
  const { padRight } = require('../src/text');
  assert.strictEqual(padRight('ab', 4), 'ab  ');
  assert.strictEqual(padRight('abcdef', 3), 'abcdef');
  assert.strictEqual(padRight(7, 3), '7  ');
  for (const f of ['report.js', 'cli.js']) {
    assert.ok(!/function pad\s*\(/.test(src(f)), f + ' still defines pad');
    assert.match(src(f), /require\(['"]\.\/text(\.js)?['"]\)/, f);
  }
});
