#!/usr/bin/env node
// Setup wizard: installs the fcode + OmniRoute + Ollama workflow on another PC.
//   node setup-wizard.js [--agent claude|antigravity] [--dest dir] [--rules file] [--project dir] [--dry-run] [--yes]
//   node setup-wizard.js --sim high|mid|low|tiny   fake the PC; installs are simulated (FCODE_SIM_FAIL=<step label,...> makes steps fail)
//   node setup-wizard.js --uninstall               removes the toolkit folder and the rules block it added
// Picks the local model from RAM/GPU/disk; you pick the agent (Claude Pro -> Claude Code, else Antigravity).
// Provider keys: the guided step opens each provider's key page, tests the pasted key, and hands it to OmniRoute's
// encrypted store on stdin (keys.js). The wizard itself never writes a key to a file.
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), rl = require('readline');
const a = process.argv.slice(2), flag = n => a.includes('--' + n), opt = n => { const i = a.indexOf('--' + n); return i < 0 ? null : a[i + 1]; };
const SIM = opt('sim'), DRY = flag('dry-run'), YES = flag('yes'), HOME = os.homedir(), SRC = __dirname;
const OMNI_VERSION = '3.8.50'; // the version fcode was tested against
const START = '<!-- fcode:start -->', END = '<!-- fcode:end -->', BLOCK = /<!-- fcode:start -->[\s\S]*<!-- fcode:end -->/;
const stamp = () => new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const sh = (f, args = []) => { try { return cp.execSync([f, ...args].join(' '), { stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }).toString().trim(); } catch { return ''; } }; // args are fixed strings, never user paths
const PF = require('./platform'), KEYS = require('./keys'), PROV = require('./providers');
const has = c => !!sh(process.platform === 'win32' ? 'where' : 'which', [c]);

// RAM/VRAM in GB -> which local models to pull. Pure, so it is unit-checked.
function pickLocal(ramGB, vramGB, freeRamGB = ramGB) {
  let m = vramGB >= 12 || ramGB >= 32 ? ['qwen2.5-coder:7b', 'gpt-oss:20b'] : vramGB >= 6 || ramGB >= 16 ? ['qwen2.5-coder:7b'] : ramGB >= 8 ? ['qwen2.5-coder:3b'] : [];
  if (!vramGB && freeRamGB < 3 && m.length) m = ['qwen2.5-coder:3b']; // CPU-only and RAM already in use: stay small
  return m;
}
const SIMS = {
  high: { ramGB: 32, vramGB: 12, gpu: 'sim 12 GB GPU', claude: true }, mid: { ramGB: 16, vramGB: 6, gpu: 'sim 6 GB GPU', claude: false },
  low: { ramGB: 8, vramGB: 0, gpu: 'none', claude: false }, tiny: { ramGB: 4, vramGB: 0, gpu: 'none', claude: false },
};
function detect() {
  if (SIM) return { node: 'sim', ollama: false, omniroute: false, agy: false, freeRamGB: SIMS[SIM].ramGB, ...SIMS[SIM] };
  const gpus = PF.scanGpus(), ramGB = Math.round(os.totalmem() / 2 ** 30); // NVIDIA, AMD, Intel, Apple Silicon (unified memory)
  return {
    ramGB, freeRamGB: Math.round(os.freemem() / 2 ** 30), vramGB: PF.usableVramGB(gpus, ramGB), gpus,
    gpu: gpus.map(g => g.name + (g.unified ? ' (shares RAM)' : '')).join(' + ') || 'none found',
    node: has('node') ? sh('node', ['-v']) : '', ollama: has('ollama'), omniroute: has('omniroute'),
    claude: has('claude') && fs.existsSync(path.join(HOME, '.claude')), // only a hint: a login does not prove an active Pro plan
    agy: has('antigravity') || has('agy'),
  };
}
const RULES = `# Delegation (free models via OmniRoute, fcode)
Tool: node "{DEST}/fcode.js" <edit|bugfix|tests|refactor|feature|explain|review> "<task>" --root <project> --files a,b --check "<cmd>"
It edits a scratch copy and writes back only if the check passes. It never commits.
- Before a task make sure the gateway is up (curl -s -o /dev/null -w %{http_code} localhost:20128/v1/models gives 401) and Ollama (localhost:11434/api/tags gives 200).
- Delegate only jobs scoped to 1-3 named files that have a check command which fails before and passes after.
- Do it yourself for design, cross-file reasoning, money/auth/security/migrations/native code, and tiny edits.
- Never send real user data, logs, secrets or keys to cloud models: use --local-only.
- After a run read git diff and run the project tests. Never let a helper commit or push.
- Never use paid Ollama models or gated providers without the user writing "ALLOW <prefix>".`;
// Starter privacy files for a project (one regex per line): .fcode-deny aborts a job on a match, .fcode-local forces local-only.
const DENY = ['(^|/)\\.env', '\\.(pem|key|jks|keystore|p12)$', '(^|/)secrets?/'];
const LOCAL = ['\\.(log|csv)$', '(^|/)(data|real)[^/]*/'];

function backup(file, text) { fs.writeFileSync(`${file}.fcode-bak-${stamp()}`, text); } // timestamped, so earlier backups are never replaced
function writeRules(file, dest) { // idempotent: replaces only its own block; backs up only when the file actually changes
  const block = `${START}\n${RULES.replace('{DEST}', dest.replace(/\\/g, '/'))}\n${END}`;
  const old = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const next = BLOCK.test(old) ? old.replace(BLOCK, block) : old + (old && !old.endsWith('\n') ? '\n' : '') + '\n' + block + '\n';
  if (DRY || next === old) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (old) backup(file, old);
  fs.writeFileSync(file, next);
}
const BS = String.fromCharCode(92);
const ideExe = () => path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe');
function launcher(dest) { // "Start Antigravity" shortcut: starts OmniRoute first if it is not answering, then opens Antigravity
  const bat = ['@echo off', 'set C=0', "for /f %%i in ('curl -s -o nul -w \"%%{http_code}\" http://localhost:20128/v1/models') do set C=%%i",
    'if not "%C%"=="401" start "OmniRoute" /min cmd /c omniroute serve', 'start "" "%LOCALAPPDATA%' + BS + 'Programs' + BS + 'Antigravity IDE' + BS + 'Antigravity IDE.exe"', ''].join(String.fromCharCode(13, 10));
  const out = [dest, path.join(HOME, 'Desktop')].filter(d => fs.existsSync(d));
  out.forEach(d => fs.writeFileSync(path.join(d, 'Start Antigravity.bat'), bat));
  return out.length;
}
function copyToolkit(dest, models) {
  if (DRY) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of ['fcode.js', 'router.js', 'providers.js', 'providers.json', 'platform.js', 'keys.js', 'rules.js', 'savings.js', 'USAGE.md', 'claude-code-mode.md']) if (fs.existsSync(path.join(SRC, f))) fs.copyFileSync(path.join(SRC, f), path.join(dest, f));
  fs.mkdirSync(path.join(dest, 'test'), { recursive: true });
  for (const f of ['router.test.js', 'chains.fixture.json']) fs.copyFileSync(path.join(SRC, 'test', f), path.join(dest, 'test', f));
  const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'router.config.json'), 'utf8'));
  const local = models.length ? 'local/' + models[0] : null;
  for (const k of Object.keys(cfg.chains)) cfg.chains[k] = cfg.chains[k].map(m => m.startsWith('local/') ? local : m).filter(Boolean);
  for (const m of Object.keys(cfg.models)) if (m.startsWith('local/') && m !== local) delete cfg.models[m];
  if (local && !cfg.models[local]) cfg.models[local] = { tier: 'cheap', class: 'small', format: 'full', rpm: 600 };
  const cfgFile = path.join(dest, 'router.config.json'), text = JSON.stringify(cfg, null, 2);
  if (fs.existsSync(cfgFile) && fs.readFileSync(cfgFile, 'utf8') !== text) backup(cfgFile, fs.readFileSync(cfgFile, 'utf8')); // keep a teammate's config edits
  fs.writeFileSync(cfgFile, text);
}
function starterFiles(project) { // creates privacy files only when missing; never overwrites
  const out = [];
  for (const [f, lines] of [['.fcode-deny', DENY], ['.fcode-local', LOCAL]]) {
    const p = path.join(project, f);
    if (fs.existsSync(p)) { out.push(`${f} already exists (kept)`); continue; }
    if (!DRY) fs.writeFileSync(p, lines.join('\n') + '\n');
    out.push(`${f} created`);
  }
  return out;
}
async function ask(q, def) { // def undefined = must type y or n (an Enter pressed while waiting must not approve an install)
  if (YES || !process.stdin.isTTY) return def === undefined ? true : def;
  const i = rl.createInterface({ input: process.stdin, output: process.stdout });
  const tag = def === undefined ? '[y/n]' : def ? '[Y/n]' : '[y/N]';
  return new Promise(r => { const go = () => i.question(`${q} ${tag} `, s => { if (!s.trim() && def === undefined) return go(); i.close(); r(s.trim() ? /^y/i.test(s) : def); }); go(); });
}
const steps = [];
const rec = (name, status, note = '') => { steps.push({ name, status, note }); return status === 'ok'; };
async function run(label, file, args, okCodes = []) { // every install is shown and confirmed first; a failure is recorded, never hidden
  console.log(`  -> ${label}: ${[file, ...args].join(' ')}`);
  if (DRY) return rec(label, 'planned');
  if (!(await ask('     run it?'))) return rec(label, 'skipped', 'you declined');
  if (SIM) return (process.env.FCODE_SIM_FAIL || '').split(',').includes(label) ? rec(label, 'failed', 'simulated failure') : rec(label, 'ok', 'simulated');
  const quiet = file === 'npm'; // npm prints nothing useful for minutes: hide its warnings, show a moving bar + timer; winget/ollama show their own progress
  const child = cp.spawn([file, ...args].join(' '), { stdio: quiet ? ['ignore', 'ignore', 'pipe'] : 'inherit', shell: true }); // fixed strings only, never user paths
  let err = '', t0 = Date.now(), tick = 0, timer;
  if (quiet) child.stderr.on('data', d => { err = (err + d).slice(-4000); }); // must always be read or npm can block
  if (quiet && process.stdout.isTTY) { // the bar only makes sense in a real terminal; the app window shows its own
    timer = setInterval(() => { const s = Math.round((Date.now() - t0) / 1000), n = tick++ % 20; process.stdout.write(`\r     [${' '.repeat(n)}=====${' '.repeat(15 - Math.abs(n - 15) % 16)}] ${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s  working, can take 5-10 min `); }, 300);
  }
  const code = await new Promise(res => { child.on('error', () => res(-1)); child.on('close', res); });
  if (timer) { clearInterval(timer); process.stdout.write('\r' + ' '.repeat(90) + '\r'); }
  const r = { status: code };
  if (quiet && code !== 0) console.log(err.split('\n').filter(l => !/^npm warn/i.test(l)).slice(-8).join('\n'));
  if (r.status === 0 || okCodes.includes(r.status)) return rec(label, 'ok', r.status === 0 ? '' : 'already up to date');
  console.log('     failed. Needs approval or administrator rights? Run it yourself in a normal terminal, then re-run the wizard (it skips what is done).');
  return rec(label, 'failed', `exit ${r.status}`);
}
function uninstall(dest) { // removes only what the wizard added; programs, pulled models and backups stay
  for (const f of [path.join(HOME, '.claude', 'CLAUDE.md'), path.join(dest, 'AGENT-RULES.md'), opt('rules')].filter(x => x && fs.existsSync(x))) {
    const old = fs.readFileSync(f, 'utf8'), next = old.replace(/\n?<!-- fcode:start -->[\s\S]*<!-- fcode:end -->\n?/, '');
    if (next !== old) { backup(f, old); fs.writeFileSync(f, next); console.log(`removed fcode block from ${f} (backup: ${f}.fcode-bak-*)`); }
  }
  fs.rmSync(dest, { recursive: true, force: true }); console.log('removed ' + dest);
}
// Real service checks: right kind of service answering, not just an open port.
async function get(u, o = {}) { try { return await fetch(u, { signal: AbortSignal.timeout(o.timeout || 3000), ...o }); } catch { return null; } }
async function probe() {
  const out = {};
  let r = await get('http://localhost:20128/v1/models');
  out.gateway = !r ? 'down' : [...r.headers.keys()].some(h => h.startsWith('x-omniroute')) ? (r.status === 401 ? 'OmniRoute up (needs key)' : `OmniRoute answered ${r.status}`) : `port 20128 is used by something else (${r.status})`;
  const key = process.env.OMNIROUTE_KEY; // read only to test, never printed
  if (key && !out.gateway.startsWith('port') && out.gateway !== 'down') { r = await get('http://localhost:20128/v1/models', { headers: { Authorization: 'Bearer ' + key } }); out.gateway += r && r.status === 200 ? '; your key works' : `; key check failed (${r ? r.status : 'no answer'})`; }
  r = await get('http://localhost:11434/api/tags');
  const j = r && r.status === 200 ? await r.json().catch(() => null) : null;
  out.ollama = !r ? 'down' : Array.isArray(j && j.models) ? `Ollama up, ${j.models.length} model(s)` : `port 11434 is used by something else (${r.status})`;
  out.ollamaModels = j && Array.isArray(j.models) ? j.models.map(m => m.name) : [];
  return out;
}
async function modelAnswers(model) { // one tiny generation: proves the model loads on this PC and answers
  const r = await get('http://localhost:11434/api/generate', { method: 'POST', timeout: 240000, body: JSON.stringify({ model, prompt: 'Reply with OK', stream: false, options: { num_predict: 4 } }) });
  const j = r && r.status === 200 ? await r.json().catch(() => null) : null;
  return j && typeof j.response === 'string';
}

async function main() {
  const dest = path.resolve(opt('dest') || path.join(HOME, 'fcode-toolkit'));
  if (flag('guide')) return guide(dest); // menu option 3: key setup only, no install
  if (flag('uninstall')) return uninstall(dest);
  const d = detect();
  console.log(`\nThis PC: ${d.ramGB} GB RAM (${d.freeRamGB} free), GPU ${d.gpu}${d.vramGB ? ` (${d.vramGB} GB)` : ''}, node ${d.node || 'MISSING'}${SIM ? '   [SIMULATED: installs are not run]' : ''}${DRY ? '   [DRY RUN]' : ''}`);
  let agent = opt('agent'), why = 'chosen with --agent';
  if (!agent) { // detection only suggests the default
    agent = (await ask(`Do you have an active Claude Pro plan? (${d.claude ? 'Claude Code login found' : 'no Claude Code login found'})`, d.claude)) ? 'claude' : 'antigravity';
    why = `you said ${agent === 'claude' ? 'yes' : 'no'} to Claude Pro; detection suggested ${d.claude ? 'claude' : 'antigravity'}`;
  }
  const models = pickLocal(d.ramGB, d.vramGB, d.freeRamGB);
  console.log(`Agent: ${agent} (${why})\n${models.length ? `Local models for this PC: ${models.join(', ')}` : 'Too little memory for a local model: cloud-only chains.'}`);
  console.log(`Toolkit goes to ${dest}\n\nInstall steps:`);
  if (!DRY) { try { fs.mkdirSync(dest, { recursive: true }); fs.accessSync(dest, fs.constants.W_OK); } catch { console.log(`Cannot write to ${dest}. Pick another folder with --dest.`); process.exitCode = 1; return; } }
  const win = process.platform === 'win32';
  const install = async (label, tool) => { // per-OS command from platform.js; a step that needs sudo is shown for you to run, never run with a password
    let pl; try { pl = PF.installPlan(tool); } catch (e) { console.log(`  -> ${label}: ${e.message}; install it yourself`); return rec(label, 'skipped', 'no installer for this OS'); }
    if (pl.sudo && !SIM && !DRY && typeof process.getuid === 'function' && process.getuid() !== 0) { console.log(`  -> ${label} needs administrator rights. Run this yourself, then re-run the wizard:\n       sudo ${pl.cmd} ${pl.args.map(x => /\s/.test(x) ? `'${x}'` : x).join(' ')}`); return rec(label, 'skipped', 'needs sudo: command shown above'); }
    return run(label, pl.cmd, pl.args);
  };
  if (!d.node) await install('Node 18+', 'node');
  if (agent === 'antigravity' && win) for (const [id, name] of [['Google.Antigravity', 'Antigravity (agy)'], ['Google.AntigravityIDE', 'Antigravity IDE']]) { // newest version of both; an up-to-date app is fine
    const have = !SIM && sh('winget', ['list', '-e', '--id', id]).includes(id);
    await run((have ? 'update ' : 'install ') + name, 'winget', [have ? 'upgrade' : 'install', '-e', '--id', id, '--accept-package-agreements', '--accept-source-agreements'], [-1978335189, 2316632107]);
  }
  if (!d.omniroute) await run('OmniRoute gateway', 'npm', ['i', '-g', `omniroute@${OMNI_VERSION}`]);
  else { const v = sh('omniroute', ['--version']); if (v && v !== OMNI_VERSION) console.log(`  (OmniRoute ${v} found; fcode was tested with ${OMNI_VERSION}. To match: npm i -g omniroute@${OMNI_VERSION})`); }
  if (models.length && !d.ollama) await install('Ollama', 'ollama');
  if (!DRY && !SIM) { // a fresh install is often not on PATH until a new terminal: re-read PATH from the registry first
    PF.refreshPath();
    const missing = [['node', d.node], ['npm i omniroute', d.omniroute], ['ollama', d.ollama]].filter(([, ok]) => !ok).map(([n]) => n.split(' ')[0]).filter(n => !has(n));
    if (missing.length) console.log(`  (${missing.join(', ')} not on PATH in this window yet: close it, open a NEW terminal and re-run the wizard to finish)`);
  }
  const have = d.ollama || SIM ? sh('ollama', ['list']) : '';
  const todo = models.filter(m => !have.includes(m));
  const freeGB = SIM ? 100 : (() => { try { const f = fs.statfsSync(HOME); return Math.floor(f.bavail * f.bsize / 2 ** 30); } catch { return 0; } })();
  const pull = freeGB < 10 ? [] : freeGB >= 30 ? todo : todo.slice(0, 1); // big second model only with 30 GB free
  if (pull.length < todo.length) { console.log(`  (${freeGB} GB free: not pulling ${todo.slice(pull.length).join(', ')}; free disk space and re-run)`); for (const m of todo.slice(pull.length)) rec('local model ' + m, 'skipped', `${freeGB} GB free`); }
  for (const m of pull) {
    if (!DRY && !SIM && (await probe()).ollama === 'down') { // installed but the service is not running
      if (await ask('  Ollama is not running. Start it now?', true)) { cp.spawn('ollama serve', { detached: true, stdio: 'ignore', shell: true }).unref(); await new Promise(r => setTimeout(r, 6000)); }
    }
    await run('local model ' + m, 'ollama', ['pull', m]);
  }
  if (agent === 'antigravity' && !d.agy) console.log('  -> Antigravity: install it from the Google Antigravity download page, sign in with a Google account.');
  copyToolkit(dest, models); rec('copy toolkit', DRY ? 'planned' : 'ok');
  // Antigravity's global rules path is unverified, so without --rules the rules sit beside the toolkit and you add them in its settings.
  const rules = opt('rules') || (agent === 'claude' ? path.join(HOME, '.claude', 'CLAUDE.md') : path.join(dest, 'AGENT-RULES.md'));
  writeRules(rules, dest); rec('agent rules', DRY ? 'planned' : 'ok', rules);
  if (agent === 'antigravity' && !DRY && process.platform === 'win32') { launcher(dest); rec('Start Antigravity shortcut', 'ok', 'on your Desktop and in ' + dest); }
  console.log(`  -> toolkit copied; agent rules written to ${rules} (a timestamped backup is made if the file changed)`);
  let privacy = 'no --project given: add .fcode-deny / .fcode-local to each project (run with --project <dir>)';
  if (opt('project')) privacy = starterFiles(path.resolve(opt('project'))).join('; ');
  const t = DRY ? '' : (() => { try { return cp.execFileSync(process.execPath, ['--test', path.join(dest, 'test', 'router.test.js')], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } }).toString(); } catch (e) { return String(e.stdout || ''); } })();
  const tests = t.split('\n').filter(l => /(pass|fail) \d+$/.test(l)).map(l => l.replace(/^\S+\s/, '')).join(', ') || (DRY ? 'not run (dry run)' : 'did not run');
  // The suite assumes a local fallback exists, so on a cloud-only PC its failures are expected and not counted.
  rec('router tests (incl. local-only fails closed)', DRY ? 'planned' : !models.length ? 'ok' : /fail 0/.test(tests) && /pass [1-9]/.test(tests) ? 'ok' : 'failed', !models.length ? `not applicable on a cloud-only PC (${tests})` : tests);
  let pr = { gateway: 'not checked', ollama: 'not checked', ollamaModels: [] }, answers = 'not checked';
  if (!DRY && !SIM) {
    pr = await probe();
    if (models.length && pr.ollamaModels.some(n => n.startsWith(models[0]))) { console.log(`  checking that ${models[0]} loads and answers (can take a minute)...`); answers = (await modelAnswers(models[0])) ? 'yes' : 'NO: model did not answer (not enough memory?)'; rec('local model answers', answers === 'yes' ? 'ok' : 'failed', answers); }
  }
  const bad = steps.filter(s => ['failed', 'skipped'].includes(s.status));
  const state = bad.length ? `INCOMPLETE: ${bad.map(s => `${s.name} (${s.status}${s.note ? ': ' + s.note : ''})`).join('; ')}. Fix those and re-run the wizard; it skips what is done.` : DRY ? 'plan only, nothing changed' : 'all wizard steps passed';
  if (!DRY) fs.writeFileSync(path.join(dest, '.fcode-install.json'), JSON.stringify({ date: new Date().toISOString(), agent, models, steps }, null, 2)); // no secrets
  console.log(`\n=== Summary for this PC ===
  Setup:        ${state}
  Agent:        ${agent} (${why})
  Local models: ${models.length ? models.join(', ') : 'none'}
  Mode:         ${!models.length ? 'cloud-only: no local fallback and NOT safe for sensitive data' : 'hybrid: cloud + local; --local-only keeps sensitive data on this PC'}
  Verified:     router tests ${tests}; gateway: ${pr.gateway}; ${pr.ollama}; local model answers: ${answers}
  Privacy:      ${privacy}
  Not verified: your provider keys${pr.gateway.includes('key works') ? ' (key works, but each provider still needs a test)' : ''}, ${agent === 'antigravity' ? 'Antigravity actually reading the rules file, ' : ''}a real job through the gateway (step 4)

Manual steps (the guided key setup below does 1 to 3 for you; your key is typed hidden and never printed or saved to a file):
  1. Start the gateway:  omniroute serve   (own terminal), open its dashboard, add your OWN free provider keys (Mistral, Groq, Gemini...).
  2. Create an OmniRoute API key there, then:  setx OMNIROUTE_KEY <key>   and open a NEW terminal. (Typing it in your own terminal is fine; never paste it in chat.)
  3. Check:  curl -s -o /dev/null -w %{http_code} localhost:20128/v1/models   -> 401 means OmniRoute is up; re-run the wizard to test your key.
  4. Try:    node "${path.join(dest, 'fcode.js')}" explain "What does this file do?" --files <a file>
  5. Sensitive work: add --local-only, and confirm nothing leaves the PC before trusting it.
  Undo:      node setup-wizard.js --uninstall${opt('dest') ? ' --dest ' + opt('dest') : ''}`);
  if (bad.length) process.exitCode = 1;
  if (!DRY && !SIM && process.stdin.isTTY) await guide(dest);
}
function askHidden(q) { // typed key is never echoed, printed or written to a file
  return new Promise(res => {
    process.stdout.write(q); let s = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const onData = c => {
      for (const ch of c) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10) { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener('data', onData); process.stdout.write('\n'); return res(s); }
        if (code === 3) process.exit(1);
        if (code === 8 || code === 127) s = s.slice(0, -1); else if (code >= 32) s += ch;
      }
    };
    process.stdin.on('data', onData);
  });
}
async function guide(dest) { // after install: start the gateway, open the dashboard, walk her through keys, open Antigravity
  if (!(await ask('\nWant me to start OmniRoute and walk you through the keys now?', true))) return;
  let g = (await probe()).gateway;
  if (g === 'down') {
    console.log('  starting OmniRoute (keep this window open)...');
    cp.spawn('omniroute serve', { detached: true, stdio: 'ignore', shell: true }).unref(); // fixed string
    for (let i = 0; i < 30 && g === 'down'; i++) { await new Promise(r => setTimeout(r, 2000)); g = (await probe()).gateway; }
  }
  if (g === 'down') return console.log('  OmniRoute did not start. Open a new terminal, run:  omniroute serve   then rerun this wizard.');
  const open = u => KEYS.openUrl(u); // fixed URLs only, on Windows, macOS and Linux
  console.log('  OmniRoute is running.');
  const prog = PF.progress(path.join(dest, '.fcode-keys-done.json')); // provider ids only, never keys: a re-run skips what worked
  const list = PROV.load().filter(p => p.status === 'free');
  const line = q => new Promise(r => { const i = rl.createInterface({ input: process.stdin, output: process.stdout }); i.question(q, s => { i.close(); r(s.trim()); }); });
  console.log('\n  STEP A - free provider keys. For each one I open its key page; you sign in, create a key, copy it, paste it here.');
  console.log('  The key is tested with a free call (no tokens used) and then saved inside OmniRoute, nowhere else.');
  const have = KEYS.configured(); // already in OmniRoute, e.g. added in its dashboard
  list.forEach((p, i) => console.log(`    ${i + 1}. ${p.name}${prog.isDone(p.id) || have.has(p.omnirouteId) ? '  (already added)' : p.recommended ? '  <- start here' : ''}   ${p.plain || Object.values(p.limits)[0]}`));
  for (;;) {
    const p = list[+(await line('    Number of a provider to add (Enter = done): ')) - 1]; if (!p) break;
    open(p.keyUrl);
    console.log(`    Opened ${p.keyUrl}. Sign in, click "Create API key" (any name), copy the key it shows once.`);
    const accountId = p.id === 'cloudflare' ? await line('    Your Cloudflare account id (on the Workers AI page): ') : undefined;
    const r = await KEYS.addKey(p.id, await askHidden(`    Paste the ${p.name} key (typing is hidden): `), { accountId, done: prog.done });
    console.log('    ' + (r.stored ? 'OK: ' : r.ok ? 'ALMOST: ' : 'NOT SAVED: ') + r.reason);
  }
  console.log(`
  STEP C - make your OmniRoute key (this is the one the toolkit uses).
    1. In the OmniRoute sidebar open "Endpoints" (it may also be called "API Keys").
    2. Click "Create key" / "New key", name it anything, and COPY it.
  Next I will ask you to paste it HERE (hidden as you type) so I can save it for you.`);
  await ask('    Copied your OmniRoute key?');
  const k = (await askHidden('  Paste your OmniRoute API key here (typing is hidden), or press Enter to skip: ')).trim();
  if (k) {
    process.env.OMNIROUTE_KEY = k;
    if (process.platform === 'win32') { const r = cp.spawnSync('setx', ['OMNIROUTE_KEY', k], { stdio: 'ignore' }); console.log(r.status === 0 ? '  key saved for NEW terminals. Checking it...' : '  could not save the key; run: setx OMNIROUTE_KEY <key> yourself.'); } // your Windows user settings, nowhere else
    else console.log('  Add this line to ~/.profile (or ~/.zshrc on a Mac) yourself so new terminals have it:  export OMNIROUTE_KEY=<your key>');
    console.log('  gateway check: ' + (await probe()).gateway);
  }
  console.log('  Install folder: ' + dest);
  if (process.platform === 'win32') cp.spawn('explorer', [dest], { stdio: 'ignore' }).unref();
  console.log('  Opening Antigravity (if nothing opens, start it yourself)...');
  cp.spawn(ideExe(), { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
  console.log(`  In Antigravity: open your project folder, then add ${path.join(dest, 'AGENT-RULES.md')} as a rule (Settings > Rules or Customizations; the exact menu name varies). Then ask it to run a small harmless task.`);
}
module.exports = { pickLocal, detect, probe, ideExe };
if (require.main === module) main();
