'use strict';
const test = require('node:test');
const assert = require('node:assert');
const K = require('../keys');

const KEY = 'gsk_' + 'k'.repeat(40);
const ok200 = async () => ({ status: 200, ok: true });
const spawnRec = (status = 0, stderr = '') => { const calls = []; const f = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { status, stderr, stdout: '' }; }; f.calls = calls; return f; };

test('a working key is tested, then given to OmniRoute on stdin, never as an argument', async () => {
  const sp = spawnRec(); const done = [];
  const r = await K.addKey('groq', '  ' + KEY + '\n', { fetchImpl: ok200, spawnSync: sp, done: (id) => done.push(id) });
  assert.deepStrictEqual([r.ok, r.stored], [true, true]);
  assert.strictEqual(sp.calls.length, 1);
  const c = sp.calls[0];
  assert.deepStrictEqual(c.args.slice(0, 4), ['providers', 'add', 'groq', '--credential-stdin']);
  assert.ok(!c.args.join(' ').includes(KEY), 'key must not be on the command line');
  assert.strictEqual(c.opts.input, KEY + '\n');
  assert.deepStrictEqual(done, ['groq']);
  assert.ok(!JSON.stringify(r).includes(KEY));
});

test('a rejected key is not stored and the message says why', async () => {
  const sp = spawnRec();
  const r = await K.addKey('groq', 'sk-wrong', { fetchImpl: async () => ({ status: 401, ok: false }), spawnSync: sp });
  assert.deepStrictEqual([r.ok, r.stored], [false, false]);
  assert.match(r.reason, /rejected/);
  assert.match(r.reason, /copy the whole/);
  assert.strictEqual(sp.calls.length, 0);
});

test('empty, spaced, unknown provider and offline cases', async () => {
  const sp = spawnRec();
  assert.match((await K.addKey('groq', '', { spawnSync: sp })).reason, /no key/);
  assert.match((await K.addKey('groq', 'gsk_a b', { spawnSync: sp })).reason, /spaces/);
  assert.match((await K.addKey('nope', KEY, { spawnSync: sp })).reason, /unknown/);
  assert.match((await K.addKey('groq', KEY, { fetchImpl: async () => { throw new Error('x'); }, spawnSync: sp })).reason, /internet/);
  assert.match((await K.addKey('cloudflare', 'x'.repeat(40), { fetchImpl: ok200, spawnSync: sp })).reason, /account id/);
  assert.strictEqual(sp.calls.length, 0);
});

test('OmniRoute failing to save is reported with the key scrubbed from its message', async () => {
  const r = await K.addKey('groq', KEY, { fetchImpl: ok200, spawnSync: spawnRec(1, 'error: server not running for ' + KEY) });
  assert.deepStrictEqual([r.ok, r.stored], [true, false]);
  assert.ok(!r.reason.includes(KEY));
  assert.match(r.reason, /dashboard/);
});

test('configured() reads active providers from OmniRoute and survives junk output', () => {
  const out = '  Loaded env from x\n[\n{"provider":"groq","isActive":true},{"provider":"mistral","isActive":false}]\n';
  assert.deepStrictEqual([...K.configured(() => ({ stdout: out }))], ['groq']);
  assert.deepStrictEqual([...K.configured(() => ({ stdout: 'x\n{"providers":[{"provider":"gemini","isActive":true}]}' }))], ['gemini']);   // real 3.x shape
  assert.strictEqual(K.configured(() => ({ stdout: 'error: not running' })).size, 0);
  assert.strictEqual(K.configured(() => { throw new Error('no omniroute'); }).size, 0);
});

test('openUrl only opens https catalog urls or localhost', () => {
  const opened = [];
  const sp = (cmd, args) => { opened.push(args[args.length - 1]); return { on: () => ({ unref() {} }) }; };
  assert.strictEqual(K.openKeyPage('groq', sp), 'https://console.groq.com/keys');
  assert.deepStrictEqual(opened, ['https://console.groq.com/keys']);
  K.openUrl('http://127.0.0.1:60274/', sp); K.openUrl('http://localhost:20128/dashboard', sp);   // the setup page and OmniRoute dashboard
  assert.throws(() => K.openUrl('http://127.0.0.1.evil.com:80/', sp));
  assert.throws(() => K.openUrl('file:///etc/passwd', sp));
  assert.throws(() => K.openUrl('https://x.com/" & calc', sp));
  assert.throws(() => K.openKeyPage('nope', sp));
});
