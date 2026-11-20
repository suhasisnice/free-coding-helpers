'use strict';
const test = require('node:test');
const assert = require('node:assert');
const P = require('../providers');

const fake = (map) => async (url, opts = {}) => {
  for (const [k, v] of Object.entries(map)) if (url.includes(k)) { if (v === 'throw') throw new Error('net'); return { status: v, ok: v >= 200 && v < 300, url, opts }; }
  return { status: 404, ok: false };
};

test('catalog loads and every entry has the fields the wizard needs', () => {
  const all = P.load();
  assert.ok(all.length >= 8);
  for (const p of all) for (const f of ['id', 'name', 'omnirouteId', 'baseUrl', 'keyUrl', 'keyFormat', 'status']) assert.ok(p[f], `${p.id} missing ${f}`);
  assert.strictEqual(P.find('groq').name, 'Groq');
  assert.strictEqual(P.find('nope'), undefined);
});

test('every free provider has one plain-words line for beginners; Groq and Gemini are the starting pair', () => {
  const list = P.load().filter((p) => p.status === 'free');
  for (const p of list) {
    assert.ok(typeof p.plain === 'string' && p.plain.length >= 20 && p.plain.length <= 110, p.id + ': plain must be 20-110 chars');
    assert.doesNotMatch(p.plain, /req\/|neurons|snippet|403|\b[RT]P[MD]\b|community|per model/i, p.id + ': no jargon or notes');
  }
  assert.deepStrictEqual(list.filter((p) => p.recommended === true).map((p) => p.id).sort(), ['gemini', 'groq']);
});

test('keyLooksRight checks the key shape and trims spaces', () => {
  const g = P.find('groq');
  assert.strictEqual(P.keyLooksRight(g, '  gsk_' + 'a'.repeat(30) + ' '), true);
  assert.strictEqual(P.keyLooksRight(g, 'sk-abc'), false);
  assert.strictEqual(P.keyLooksRight(g, ''), false);
});

test('testKey: 200 ok, 401 rejected, other status, unreachable; key sent as bearer, never in the reason', async () => {
  const g = P.find('groq');
  const key = 'gsk_' + 'b'.repeat(30);
  let seen;
  const ok = await P.testKey(g, key, async (url, opts) => { seen = { url, opts }; return { status: 200, ok: true }; });
  assert.deepStrictEqual(ok, { ok: true });
  assert.strictEqual(seen.url, 'https://api.groq.com/openai/v1/models');
  assert.strictEqual(seen.opts.headers.authorization, 'Bearer ' + key);
  assert.deepStrictEqual(await P.testKey(g, key, fake({ groq: 401 })), { ok: false, reason: 'rejected' });
  assert.deepStrictEqual(await P.testKey(g, key, fake({ groq: 403 })), { ok: false, reason: 'rejected' });
  assert.deepStrictEqual(await P.testKey(g, key, fake({ groq: 500 })), { ok: false, reason: 'http 500' });
  const un = await P.testKey(g, key, fake({ groq: 'throw' }));
  assert.deepStrictEqual(un, { ok: false, reason: 'unreachable' });
});

test('testKey: cloudflare needs an account id, then fills it into the url', async () => {
  const c = P.find('cloudflare');
  assert.deepStrictEqual(await P.testKey(c, 'x'.repeat(40), fake({})), { ok: false, reason: 'needs account id' });
  let url;
  await P.testKey(c, 'x'.repeat(40), async (u) => { url = u; return { status: 200, ok: true }; }, { accountId: 'abc123' });
  assert.strictEqual(url, 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1/models');
});

test('reach: key page and api answer without a key; alive when api is 200/401/403/404 and page < 500', async () => {
  const g = P.find('groq');
  assert.deepStrictEqual(await P.reach(g, fake({ 'console.groq.com': 200, 'api.groq.com': 401 })), { page: 200, api: 401, alive: true });
  assert.deepStrictEqual(await P.reach(g, fake({ 'console.groq.com': 200, 'api.groq.com': 503 })), { page: 200, api: 503, alive: false });
  assert.deepStrictEqual(await P.reach(g, fake({ 'console.groq.com': 'throw', 'api.groq.com': 401 })), { page: 0, api: 401, alive: false });
});
