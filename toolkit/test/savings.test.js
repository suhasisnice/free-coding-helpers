'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { tally, renderHtml } = require('../savings');

const rows = [
  { event: 'job', model: 'groq/a', status: 'verified', inlineIn: 1000, inlineOut: 500, delegIn: 300, delegOut: 100 },
  { event: 'job', model: 'groq/a', status: 'failed', reason: 'edit not applicable', inlineIn: 800, inlineOut: 400, delegIn: 200, delegOut: 50 },
  { event: 'job', model: 'nvidia/b', status: 'verified', inlineIn: 2000, inlineOut: 1000, delegIn: 500, delegOut: 200 },
  { model: 'groq/a', status: 200, tokens: 4000 },
  { model: 'groq/a', status: 429, tokens: null },
  { model: 'nvidia/b', status: 200, tokens: 6000 },
];

test('tally: per provider jobs, verified, failures, helper tokens, Claude tokens saved and dollars', () => {
  const t = tally(rows, { inPerM: 3, outPerM: 15 });
  const g = t.providers.groq, n = t.providers.nvidia;
  assert.deepStrictEqual([g.jobs, g.verified, g.failed, g.r429, g.helperTokens], [2, 1, 1, 1, 4000]);
  // saved counts only verified jobs: Claude would have spent inline, instead spent deleg
  assert.strictEqual(g.savedIn, 1000 - 300);
  assert.strictEqual(g.savedOut, 500 - 100);
  // failed jobs still cost Claude its delegation tokens
  assert.strictEqual(g.wastedIn, 200);
  assert.strictEqual(g.wastedOut, 50);
  // dollars = (savedIn - wastedIn) * inPerM/1e6 + (savedOut - wastedOut) * outPerM/1e6
  assert.strictEqual(+g.dollars.toFixed(6), +((500 * 3 + 350 * 15) / 1e6).toFixed(6));
  assert.deepStrictEqual([n.jobs, n.verified, n.savedIn, n.savedOut], [1, 1, 1500, 800]);
  assert.deepStrictEqual(g.reasons, { 'edit not applicable': 1 });
  assert.strictEqual(t.total.jobs, 3);
  assert.strictEqual(t.total.verified, 2);
  assert.strictEqual(+t.total.dollars.toFixed(6), +(g.dollars + n.dollars).toFixed(6));
});

test('renderHtml: a full page with one row per provider and the totals, escaping text', () => {
  const t = tally([...rows, { event: 'job', model: '<x>/m', status: 'failed', reason: '<b>bad</b>' }], { inPerM: 3, outPerM: 15 });
  const html = renderHtml(t);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.ok(html.includes('groq') && html.includes('nvidia'));
  assert.ok(!html.includes('<b>bad</b>') && html.includes('&lt;b&gt;bad&lt;/b&gt;'));
  assert.ok(html.includes('$'));
});

test('a job that failed on every model (no model name) is still counted', () => {
  const t = tally([{ event: 'job', model: null, status: 'failed', reason: 'x', delegIn: 10, delegOut: 5 }]);
  assert.strictEqual(t.total.jobs, 1);
  assert.strictEqual(t.total.failed, 1);
  assert.strictEqual(Object.keys(t.providers).length, 1);
});
