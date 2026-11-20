'use strict';
// Run: node --test toolkit/test   (no network, no quota: fetch is replaced by a script)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
process.env.FCODE_USAGE_DIR = fs.mkdtempSync(require('path').join(os.tmpdir(), 'fcode-usage-'));   // never read or write the real per-model usage log
const path = require('path');
const { Router, Fatal, loadConfig } = require('../router');
const { runJob, checkDeny } = require('../fcode');

const REAL_FETCH = globalThis.fetch;
const CS = 'mistral/codestral-latest', FL = 'gemini/gemini-flash-lite-latest', LOCAL = 'local/qwen2.5-coder:7b';
const SECRET = 'SECRET-LANDOWNER-1234';
const GOOD = 'FILE: a.js\n```\nmodule.exports = 2;\n```';
const BAD = 'FILE: a.js\n```\nmodule.exports = 3;\n```';
const CHECK = `node -e "process.exit(require('./a.js')===2?0:1)"`;
const G429 = '{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","details":[{"retryDelay":"34s"}]}}';

process.env.OMNIROUTE_KEY = 'test-key';

// script: (model, kind) => { status, text } ; kind is 'cloud' or 'local'. Returns the call log.
function mock(script, { tags = ['qwen2.5-coder:7b'], localDown = false } = {}) {
  const seen = { cloud: [], local: [], tags: 0, probes: 0, bodies: [] };
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes(':11434')) {
      seen.probes++;
      if (localDown) throw new TypeError('fetch failed');
      if (u.endsWith('/api/tags')) { seen.tags++; return new Response(JSON.stringify({ models: tags.map((name) => ({ name })) })); }
      const b = JSON.parse(opts.body); seen.local.push(b); seen.bodies.push(opts.body);
      const r = script(LOCAL, 'local');
      return new Response(JSON.stringify({ message: { content: r.text || '' }, done_reason: 'stop', prompt_eval_count: 5, eval_count: 5 }), { status: r.status || 200 });
    }
    const b = JSON.parse(opts.body); seen.cloud.push(b.model); seen.bodies.push(opts.body);
    const r = script(b.model, 'cloud');
    if ((r.status || 200) !== 200) return new Response(r.body || 'err', { status: r.status, headers: r.headers });
    return new Response(JSON.stringify({ choices: [{ message: { content: r.text } }], usage: { total_tokens: 10 } }));
  };
  return seen;
}
test.afterEach(() => { globalThis.fetch = REAL_FETCH; });

function cfgFast(patch) {
  const cfg = loadConfig(patch);
  cfg.stream = false; cfg.safety = 1; cfg.maxRetries = 5; cfg.callCap = 1e6;
  cfg.chains = JSON.parse(fs.readFileSync(path.join(__dirname, 'chains.fixture.json'), 'utf8'));   // fixed order: rules.js may reorder the live config
  for (const m of Object.values(cfg.models)) { m.rpm = 1e6; delete m.limits; }   // published-limit pacing has its own test
  return cfg;
}
function project(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fcode-test-'));
  fs.writeFileSync(path.join(root, 'a.js'), 'module.exports = 1;\n');
  for (const [f, t] of Object.entries(extra)) fs.writeFileSync(path.join(root, f), t);
  return root;
}
const read = (root) => fs.readFileSync(path.join(root, 'a.js'), 'utf8');
const job = (root, router, cfg, o = {}) => runJob({ type: 'edit', instruction: 'make it 2', files: ['a.js'], check: CHECK, root, router, cfg, ...o });

test('1 normal cloud routing: first model answers, change is written back', async () => {
  const seen = mock(() => ({ text: GOOD }));
  const cfg = cfgFast(); const root = project();
  const r = await job(root, new Router(cfg), cfg);
  assert.ok(r.verified); assert.strictEqual(r.model, CS);
  assert.deepStrictEqual(seen.cloud, [CS]); assert.strictEqual(seen.local.length, 0);
  assert.match(read(root), /= 2;/);
});

test('2 a failing provider advances to the next one in the chain', async () => {
  const seen = mock((m) => (m === CS ? { status: 500 } : { text: GOOD }));
  const cfg = cfgFast(); const root = project();
  const r = await job(root, new Router(cfg), cfg);
  assert.ok(r.verified); assert.strictEqual(r.model, FL);
  assert.deepStrictEqual(seen.cloud, [CS, FL]);
});

test('3 every cloud model failing falls back to local Ollama (even past maxRetries)', async () => {
  const seen = mock((m, k) => (k === 'local' ? { text: GOOD } : { status: 500 }));
  const cfg = cfgFast(); const root = project();
  const r = await job(root, new Router(cfg), cfg);
  assert.ok(r.verified); assert.strictEqual(r.model, LOCAL);
  assert.strictEqual(seen.cloud.length, cfg.maxRetries + 1);
  assert.strictEqual(seen.local[0].options.num_ctx, 16384);   // the 4k default would silently cut prompts
  assert.match(read(root), /= 2;/);
});

test('4 local endpoint down: fails gracefully and is not hammered', async () => {
  const seen = mock(() => ({ text: GOOD }), { localDown: true });
  const cfg = cfgFast(); const root = project();
  const router = new Router(cfg, { localOnly: true });
  const r1 = await job(root, router, cfg, { localOnly: true });
  const r2 = await job(root, router, cfg, { localOnly: true });
  assert.ok(!r1.verified && !r2.verified);
  assert.strictEqual(seen.cloud.length, 0);
  assert.strictEqual(seen.probes, 1);   // second job reused the cached 'down', no new probe
  assert.match(read(root), /= 1;/);   // untouched
});

test('5 local model not installed: never sent a chat request', async () => {
  const seen = mock(() => ({ text: GOOD }), { tags: ['llama3:8b'] });
  const cfg = cfgFast(); const root = project();
  const r = await job(root, new Router(cfg, { localOnly: true }), cfg, { localOnly: true });
  assert.ok(!r.verified); assert.strictEqual(seen.local.length, 0); assert.strictEqual(seen.tags, 1);
});

test('6 retry cap: all cloud down + local down = maxRetries+1 gateway calls, then stop', async () => {
  const seen = mock(() => ({ status: 500 }), { localDown: true });
  const cfg = cfgFast(); const root = project();
  const r = await job(root, new Router(cfg), cfg);
  assert.ok(!r.verified); assert.strictEqual(seen.cloud.length, cfg.maxRetries + 1);
});

test('6b attempt cap: models that answer wrongly stop at maxAttempts', async () => {
  const seen = mock(() => ({ text: BAD }));
  const cfg = cfgFast(); const root = project();
  const r = await job(root, new Router(cfg), cfg);
  assert.ok(!r.verified); assert.strictEqual(r.attempts, cfg.maxAttempts);
  assert.ok(seen.cloud.length <= cfg.maxAttempts * 2);   // fresh + one feedback round per attempt
  assert.match(read(root), /= 1;/);   // 11: check failed, nothing written back
  assert.strictEqual(seen.local.length, 0);
});

test('7 cooldowns: 429 honours reset_seconds, three 5xx trip the 5-minute breaker', async () => {
  const cfg = cfgFast(); const router = new Router(cfg);
  mock(() => ({ status: 429, body: '{"reset_seconds": 120}' }));
  await assert.rejects(router.chat(CS, [{ role: 'user', content: 'x' }]), (e) => e.retry);
  let left = (router.state[CS].coolUntil - Date.now()) / 1000;
  assert.ok(left > 110 && left <= 120, `cool ${left}`);
  mock(() => ({ status: 503 }));
  for (let i = 0; i < 3; i++) await assert.rejects(router.chat(FL, [{ role: 'user', content: 'x' }]), (e) => e.retry);
  left = (router.state[FL].coolUntil - Date.now()) / 1000;
  assert.ok(left > 290 && left <= 300, `breaker ${left}`);
});

test('8 paid Ollama models stay blocked: aliases, case, patches and ALLOW cannot unblock', async () => {
  const seen = mock(() => ({ text: GOOD }));
  const cfg = cfgFast({ never: [], allow: ['ollamacloud/', 'ollama-cloud/'] });
  const router = new Router(cfg);
  for (const id of ['ollamacloud/kimi-k2', 'OllamaCloud/Kimi-K2', 'ollama-cloud/deepseek-v3.1', 'Ollama-Cloud/GLM-4.6', 'ollamacloud/minimax-m2', 'ollama-cloud/mistral-large-3:675b']) {
    assert.ok(router.blocked(id), id);
    await assert.rejects(router.chat(id, [{ role: 'user', content: 'x' }]), Fatal);
  }
  assert.strictEqual(seen.cloud.length, 0);
  assert.ok(!router.blocked('ollamacloud/gpt-oss:20b'));
  for (const c of Object.values(cfg.chains)) for (const m of c) assert.ok(!/kimi|deepseek|glm|minimax|mistral-large-3/i.test(m) || m.startsWith('groq/'), m);
});

test('9 sensitive jobs never reach the gateway, even when local fails', async () => {
  delete process.env.OMNIROUTE_KEY;   // a local-only router must not need (or load) the cloud key
  try {
    const seen = mock((m, k) => (k === 'local' ? { status: 500 } : { text: GOOD }));
    const cfg = cfgFast(); const root = project({ '.fcode-local': '^a\\.js$\n' });
    fs.writeFileSync(path.join(root, 'a.js'), `module.exports = 1; // ${SECRET}\n`);
    const logs = [];
    const router = new Router(cfg, { localOnly: true });
    assert.strictEqual(router.key, null);
    const r = await job(root, router, cfg, { log: (x) => logs.push(JSON.stringify(x)) });   // sensitive via .fcode-local, no flag
    assert.ok(!r.verified);
    assert.strictEqual(seen.cloud.length, 0);
    assert.ok(seen.local.length >= 1);
    assert.ok(!logs.join('').includes(SECRET), 'file content leaked into the log');
    // a cloud-capable router given a sensitive job is refused outright
    process.env.OMNIROUTE_KEY = 'test-key';
    await assert.rejects(job(root, new Router(cfg), cfg), Fatal);
    assert.strictEqual(seen.cloud.length, 0);
    // and a local-only router refuses any cloud model directly
    await assert.rejects(router.chat(CS, [{ role: 'user', content: SECRET }]), Fatal);
    assert.strictEqual(seen.cloud.length, 0);
  } finally { process.env.OMNIROUTE_KEY = 'test-key'; }
});

test('9b sensitive job that succeeds locally sends only to local Ollama', async () => {
  const seen = mock((m, k) => ({ text: GOOD }));
  const cfg = cfgFast(); const root = project();
  const r = await job(root, new Router(cfg, { localOnly: true }), cfg, { localOnly: true });
  assert.ok(r.verified); assert.strictEqual(r.model, LOCAL);
  assert.strictEqual(seen.cloud.length, 0);
});

test('9c deny-listed files still abort unless the job is local-only', () => {
  const root = project();
  assert.throws(() => checkDeny(root, ['src/db/x.js']), /deny-list/);
  assert.doesNotThrow(() => checkDeny(root, ['src/db/x.js'], true));
});

test('10 config is valid: every chain id is a known, unblocked model; local is last; ghm absent', () => {
  const cfg = loadConfig(); const router = new Router(cfg);
  for (const [type, chain] of Object.entries(cfg.chains)) {
    assert.strictEqual(new Set(chain).size, chain.length, type);
    for (const m of chain) { assert.ok(cfg.models[m], `${type}: ${m} missing from models`); assert.strictEqual(router.blocked(m), null, m); }
    assert.strictEqual(chain.at(-1), LOCAL, type);
    assert.ok(!chain.some((m) => m.startsWith('ghm/')));
  }
  assert.ok(cfg.models[LOCAL].local && cfg.models[LOCAL].numCtx >= 8192);
  assert.deepStrictEqual(loadConfig({ never: ['x/'] }).never.filter((n) => n === 'x/' || n === 'ollamacloud/kimi-').length, 2);
});

// ---------- Gemini quota handling, auth errors, call cap, local-only isolation ----------
const G120 = 'groq/openai/gpt-oss-120b';
const msg = [{ role: 'user', content: 'x' }];

test('11 Gemini 429 "exceeded your current quota" fails over instead of aborting the job', async () => {
  const seen = mock((m) => (m === CS ? { status: 500 } : m === FL ? { status: 429, body: G429 } : { text: GOOD }));
  const cfg = cfgFast(); const root = project(); const router = new Router(cfg);
  const r = await job(root, router, cfg);
  assert.ok(r.verified); assert.strictEqual(r.model, G120);
  assert.deepStrictEqual(seen.cloud, [CS, FL, G120]);
  assert.strictEqual(r.attempts, 1);   // transport failures never use up the 3-attempt budget
  assert.strictEqual(router.stats.r429, 1);
});

test('12 an exhausted Gemini model is not called again: retryDelay, Retry-After and PerDay cooldowns', async () => {
  const seen = mock((m) => (m === FL ? { status: 429, body: G429 } : { text: GOOD }));
  const cfg = cfgFast(); const router = new Router(cfg);
  // chain head codestral is made unavailable so Gemini is tried first
  router.state[CS] = { ...router.st(CS), coolUntil: Date.now() + 1e6 };
  const root = project();
  await job(root, router, cfg); fs.writeFileSync(path.join(root, 'a.js'), 'module.exports = 1;\n');
  await job(root, router, cfg);
  assert.strictEqual(seen.cloud.filter((m) => m === FL).length, 1);
  let left = (router.state[FL].coolUntil - Date.now()) / 1000;
  assert.ok(left > 30 && left <= 34, `retryDelay ${left}`);
  mock(() => ({ status: 429, body: G429, headers: { 'retry-after': '90' } }));
  const r2 = new Router(cfg);
  await assert.rejects(r2.chat(FL, msg), (e) => e.retry && !(e instanceof Fatal));
  left = (r2.state[FL].coolUntil - Date.now()) / 1000;
  assert.ok(left > 85 && left <= 90, `Retry-After ${left}`);
  mock(() => ({ status: 429, body: '{"error":{"message":"You exceeded your current quota","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}' }));
  const r3 = new Router(cfg);
  await assert.rejects(r3.chat(FL, msg), (e) => e.retry);
  assert.ok((r3.state[FL].coolUntil - Date.now()) / 1000 > 3500);
});

test('13 auth and malformed-request errors are not rate limits; 402 and other providers\' quota text stay Fatal', async () => {
  const cfg = cfgFast();
  mock(() => ({ status: 401, body: '{"error":{"message":"API key not valid"}}' }));
  const a = new Router(cfg);
  await assert.rejects(a.chat(FL, msg), (e) => e.client && !(e instanceof Fatal));
  assert.strictEqual(a.stats.r429, 0);
  assert.ok((a.state[FL].coolUntil - Date.now()) / 1000 > 290);   // benched, not retried next job
  mock(() => ({ status: 400, body: '{"error":{"message":"Invalid JSON payload"}}' }));
  const b = new Router(cfg);
  await assert.rejects(b.chat(FL, msg), (e) => e.client && !(e instanceof Fatal));
  assert.strictEqual(b.stats.r429, 0); assert.strictEqual(b.state[FL].coolUntil, 0);
  mock(() => ({ status: 429, body: G429 }));
  await assert.rejects(new Router(cfg).chat(CS, msg), Fatal);   // mistral quota text: still the stop rule
  mock(() => ({ status: 402, body: 'payment required' }));
  await assert.rejects(new Router(cfg).chat(FL, msg), Fatal);   // 402 on Gemini too
});

test('14 lifetime call cap is enforced, including mid-job', async () => {
  const seen = mock(() => ({ status: 500 }));
  const cfg = cfgFast(); cfg.callCap = 10; cfg.callsUsed = 10;
  await assert.rejects(new Router(cfg).chat(CS, msg), Fatal);
  assert.strictEqual(seen.cloud.length, 0);
  cfg.callsUsed = 8;
  await assert.rejects(job(project(), new Router(cfg), cfg), Fatal);
  assert.strictEqual(seen.cloud.length, 2);   // cap reached after two real calls; the job aborted, no fallback past the cap
});

test('15 local-only jobs contact no cloud provider after any local failure mode', async () => {
  const modes = {
    'http 500': () => ({ status: 500 }),
    'http 429 with quota text': () => ({ status: 429, text: 'quota' }),
    'empty reply': () => ({ text: '' }),
    'wrong answer': () => ({ text: BAD }),
  };
  for (const [name, script] of Object.entries(modes)) {
    const seen = mock((m, k) => (k === 'local' ? script() : { text: GOOD }));
    const cfg = cfgFast(); const root = project();
    await job(root, new Router(cfg, { localOnly: true }), cfg, { localOnly: true }).catch((e) => assert.ok(e instanceof Fatal, name));
    assert.strictEqual(seen.cloud.length, 0, name);
    assert.match(read(root), /= 1;/, name);
  }
  const seen = mock(() => ({ text: GOOD }), { localDown: true });
  const cfg = cfgFast(); const root = project();
  await job(root, new Router(cfg, { localOnly: true }), cfg, { localOnly: true });
  assert.strictEqual(seen.cloud.length, 0);
});

test('published limits: a model is held back before it would cross tokens/min or req/day, and the log survives a new Router', () => {
  const cfg = cfgFast();
  process.env.FCODE_USAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fcode-usage-'));   // empty log for this test
  cfg.models[G120].limits = { tpm: 8000, rpd: 5 };
  const a = new Router(cfg);
  assert.strictEqual(a.waitFor(G120), 0);
  for (let i = 0; i < 2; i++) a.logUse(G120, 3000);       // 6000 + next ~3000 > 0.8 * 8000
  const w = a.waitFor(G120);
  assert.ok(w > 55000 && w <= 60000, `tpm wait ${w}`);
  const b = new Router(cfg);                               // a second process sees the same log
  assert.strictEqual(b.windowUse(G120, 60000).calls, 2);
  cfg.models[G120].limits = { rpd: 3 };                    // 2 used, 0.8 * 3 = 2.4 -> floor 2: no room for a 3rd today
  assert.ok(new Router(cfg).waitFor(G120) > 3600000);
  assert.strictEqual(Router.secs('2m59.5s'), 179.5);
});

test('a request bigger than the model tokens/min limit is skipped without a call (Groq "Request too large")', async () => {
  const seen = mock(() => ({ text: GOOD }));
  const cfg = cfgFast(); cfg.models[G120].limits = { tpm: 8000 };
  const r = new Router(cfg);
  await assert.rejects(r.chat(G120, [{ role: 'user', content: 'x'.repeat(30000) }], { maxTokens: 4096 }), (e) => e.retry && e.noCall && /tokens\/min/.test(e.message));
  assert.strictEqual(seen.cloud.length, 0);
  await r.chat(G120, msg, { maxTokens: 1000 });
  assert.strictEqual(seen.cloud.length, 1);
});
