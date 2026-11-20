// Run: node --test test/wizard.test.js   (simulated PCs only; installs are never executed)
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const { pickLocal } = require('../setup-wizard.js');
const W = path.join(__dirname, '..', 'setup-wizard.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wiz '));      // space in the path on purpose
const wiz = (args, env = {}) => cp.spawnSync(process.execPath, [W, '--yes', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

test('model choice by specs', () => {
  assert.deepEqual(pickLocal(32, 12), ['qwen2.5-coder:7b', 'gpt-oss:20b']);
  assert.deepEqual(pickLocal(16, 0), ['qwen2.5-coder:7b']);
  assert.deepEqual(pickLocal(8, 0), ['qwen2.5-coder:3b']);
  assert.deepEqual(pickLocal(4, 0), []);
  assert.deepEqual(pickLocal(16, 0, 2), ['qwen2.5-coder:3b']);          // RAM mostly in use, no GPU
});
test('simulated install: one rules block, user text kept, config patched, uninstall restores', () => {
  const t = tmp(), rules = path.join(t, 'R.md'), dest = path.join(t, 'my toolkit & co');
  fs.writeFileSync(rules, 'keep me\n');
  for (let i = 0; i < 2; i++) { const r = wiz(['--sim', 'mid', '--agent', 'antigravity', '--dest', dest, '--rules', rules]); assert.equal(r.status, 0, r.stdout + r.stderr); }
  const txt = fs.readFileSync(rules, 'utf8');
  assert.equal(txt.split('fcode:start').length - 1, 1); assert.match(txt, /^keep me/);
  assert.equal(fs.readdirSync(t).filter(f => f.includes('.fcode-bak-')).length, 1); // rerun with no change makes no new backup
  const cfg = JSON.parse(fs.readFileSync(path.join(dest, 'router.config.json'), 'utf8'));
  assert.ok(Object.values(cfg.chains).every(c => c.at(-1) === 'local/qwen2.5-coder:7b'));
  assert.ok(fs.existsSync(path.join(dest, 'test', 'router.test.js')));
  wiz(['--uninstall', '--dest', dest, '--rules', rules]);
  assert.equal(fs.readFileSync(rules, 'utf8').trim(), 'keep me'); assert.ok(!fs.existsSync(dest));
});
test('a failed install step is reported, exit code 1, nothing claims complete', () => {
  const t = tmp(), r = wiz(['--sim', 'high', '--agent', 'claude', '--dest', path.join(t, 'tk'), '--rules', path.join(t, 'R.md')], { FCODE_SIM_FAIL: 'Ollama' });
  assert.equal(r.status, 1); assert.match(r.stdout, /INCOMPLETE: Ollama \(failed/); assert.doesNotMatch(r.stdout, /all wizard steps passed/);
});
test('tiny PC: cloud-only config still valid and warned as not safe for sensitive data', () => {
  const t = tmp(), dest = path.join(t, 'tk'), r = wiz(['--sim', 'tiny', '--agent', 'antigravity', '--dest', dest]);
  assert.equal(r.status, 0, r.stdout); assert.match(r.stdout, /NOT safe for sensitive data/);
  const cfg = JSON.parse(fs.readFileSync(path.join(dest, 'router.config.json'), 'utf8'));
  assert.ok(!JSON.stringify(cfg).includes('local/'));
});
test('edited config is backed up before an update overwrites it', () => {
  const t = tmp(), dest = path.join(t, 'tk'), args = ['--sim', 'mid', '--agent', 'antigravity', '--dest', dest];
  wiz(args); const f = path.join(dest, 'router.config.json'); fs.writeFileSync(f, '{"mine":1}'); wiz(args);
  assert.ok(fs.readdirSync(dest).some(n => n.startsWith('router.config.json.fcode-bak-')));
});
test('--project creates privacy starter files only when missing', () => {
  const t = tmp(), p = path.join(t, 'proj'); fs.mkdirSync(p); fs.writeFileSync(path.join(p, '.fcode-deny'), 'mine\n');
  wiz(['--sim', 'mid', '--agent', 'antigravity', '--dest', path.join(t, 'tk'), '--project', p]);
  assert.equal(fs.readFileSync(path.join(p, '.fcode-deny'), 'utf8'), 'mine\n'); assert.ok(fs.existsSync(path.join(p, '.fcode-local')));
});
