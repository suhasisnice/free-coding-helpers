'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildRules, applyChains, isInfraFailure } = require('../rules');

const job = (model, type, ok, reason) => ({ event: 'job', model, type, status: ok ? 'verified' : 'failed', reason });
const many = (model, type, pass, fail, reason) => [...Array(pass)].map(() => job(model, type, true)).concat([...Array(fail)].map(() => job(model, type, false, reason || 'edit not applicable')));

test('isInfraFailure: rate limits, gateway and credential errors are not the model being wrong', () => {
  for (const r of ['groq/x 429, cooling 60s', 'gemini/x 502 {"message"', 'call cap 1500 reached', 'mistral/x 401: No active credentials', 'STOP: x returned 402', 'gemini/x cooling for 120s', 'timeout', 'stream cut'])
    assert.strictEqual(isInfraFailure(r), true, r);
  for (const r of ['edit not applicable', 'check failed: answer is missing required facts', undefined]) assert.strictEqual(isInfraFailure(r), false, String(r));
});

test('buildRules ranks models per type, ignores infra failures, and decides delegate by threshold', () => {
  const rows = [
    ...many('a', 'edit', 9, 1), ...many('b', 'edit', 6, 4), ...many('c', 'edit', 2, 0),
    ...many('a', 'refactor', 2, 6), ...many('b', 'refactor', 3, 5),
    ...many('b', 'bugfix', 4, 0), ...many('b', 'bugfix', 0, 6, 'b 429, cooling 60s'),
    { model: 'a', status: 200 },
  ];
  const r = buildRules(rows, { threshold: 0.8, minJobs: 3 });
  assert.deepStrictEqual(r.types.edit.ranked.map((m) => m.model), ['a', 'b']);   // c has only 2 judged jobs
  assert.deepStrictEqual(r.types.edit.ranked[0], { model: 'a', passed: 9, judged: 10, rate: 0.9 });
  assert.strictEqual(r.types.edit.delegate, true);
  assert.strictEqual(r.types.refactor.delegate, false);   // best is 3/8
  assert.deepStrictEqual(r.types.bugfix.ranked, [{ model: 'b', passed: 4, judged: 4, rate: 1 }]);
  assert.strictEqual(r.types.bugfix.delegate, true);
  assert.strictEqual(r.threshold, 0.8);
});

test('applyChains puts ranked models (rate >= minRate) first, keeps unranked models after, drops excluded ones', () => {
  const cfg = { chains: { edit: ['b', 'x', 'local/q', 'a'], refactor: ['a', 'b'], tests: ['b', 'a'] } };
  const rules = { types: {
    edit: { ranked: [{ model: 'a', rate: 0.9 }, { model: 'b', rate: 0.6 }, { model: 'z', rate: 0.2 }] },
    refactor: { ranked: [{ model: 'b', rate: 0.4 }, { model: 'a', rate: 0.25 }] },
  } };
  const out = applyChains(cfg, rules, { minRate: 0.5, exclude: ['x'] });
  assert.deepStrictEqual(out.chains.edit, ['a', 'b', 'local/q']);
  assert.deepStrictEqual(out.chains.refactor, ['a', 'b']);   // nothing reaches minRate: chain left as it was
  assert.deepStrictEqual(out.chains.tests, ['b', 'a']);       // no data: unchanged
  assert.deepStrictEqual(cfg.chains.edit, ['b', 'x', 'local/q', 'a']);   // input not modified
});
