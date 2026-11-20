'use strict';
// Per-provider key step for the wizard: open the provider's key page, check the pasted key with a free
// live call (GET /models, no tokens used), then hand it to OmniRoute's encrypted store on stdin.
// The key is never put on a command line, in a file, or in any returned value or log.
const cp = require('child_process');
const P = require('./providers');

const OMNI = process.platform === 'win32' ? 'omniroute.cmd' : 'omniroute';

function openUrl(url, spawn = cp.spawn) {
  if (!/^https:\/\/[^\s"'<>]+$/.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/[^\s"'<>]*$/.test(url)) throw new Error('refusing to open ' + url);
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
}

// Opens the key page of a catalog provider (only catalog URLs, never one typed by the user).
function openKeyPage(id, spawn) {
  const p = P.find(id);
  if (!p) throw new Error('unknown provider ' + id);
  openUrl(p.keyUrl, spawn);
  return p.keyUrl;
}

// -> { ok, stored, reason }. deps lets tests replace fetch and spawnSync.
async function addKey(id, rawKey, { accountId, fetchImpl = fetch, spawnSync = cp.spawnSync, done } = {}) {
  const p = P.find(id);
  if (!p) return { ok: false, stored: false, reason: 'unknown provider' };
  const key = String(rawKey || '').trim();
  if (!key) return { ok: false, stored: false, reason: 'no key pasted' };
  if (/\s/.test(key)) return { ok: false, stored: false, reason: 'paste just the key: it has spaces or line breaks in it' };
  const shapeOk = P.keyLooksRight(p, key);
  const t = await P.testKey(p, key, fetchImpl, { accountId });
  if (!t.ok) {
    const why = t.reason === 'rejected' ? `${p.name} rejected that key${shapeOk ? '' : " (it also doesn't look like a " + p.name + ' key; did you copy the whole thing?)'}`
      : t.reason === 'needs account id' ? 'Cloudflare also needs your account id (shown on the Workers AI page)'
      : `could not check the key (${t.reason}); is the internet up?`;
    return { ok: false, stored: false, reason: why };
  }
  const args = ['providers', 'add', p.omnirouteId, '--credential-stdin', '--yes'];
  if (accountId) args.push('--provider-specific-data', JSON.stringify({ accountId }));
  const r = spawnSync(OMNI, args, { input: key + '\n', encoding: 'utf8', timeout: 30000, shell: process.platform === 'win32' });
  if (r.status !== 0) {
    const msg = String(r.stderr || r.stdout || r.error || '').replace(key, '[key]').split('\n').filter((l) => l.trim() && !/Loaded env|STORAGE_ENCRYPTION_KEY/.test(l)).slice(-2).join(' ').slice(0, 200);
    return { ok: true, stored: false, reason: `the key works, but OmniRoute did not save it (${msg || 'exit ' + r.status}). Is OmniRoute running? Add it in its dashboard instead.` };
  }
  if (done) done(id);
  return { ok: true, stored: true, reason: `${p.name} key works and is saved in OmniRoute` };
}

// OmniRoute provider ids that already have an active connection, so the wizard does not ask again.
// `providers list --json` carries names and status only, no key fields. Any failure -> empty set.
function configured(spawnSync = cp.spawnSync) {
  try {
    const s = String(spawnSync(OMNI, ['providers', 'list', '--json'], { encoding: 'utf8', timeout: 15000, shell: process.platform === 'win32' }).stdout || '');
    const j = JSON.parse(s.slice(s.search(/^[[{]/m)));
    return new Set((Array.isArray(j) ? j : j.providers || []).filter((c) => c.isActive).map((c) => c.provider));
  } catch { return new Set(); }
}

module.exports = { openUrl, openKeyPage, addKey, configured };
