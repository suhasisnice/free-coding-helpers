// Setup app: a tiny local web server (127.0.0.1 only) + one page. It drives setup-wizard.js; nothing here talks to the internet.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process'), crypto = require('crypto');
const W = require('./setup-wizard.js'), KEYS = require('./keys'), PROV = require('./providers'), PF = require('./platform');
const TOKEN = crypto.randomBytes(16).toString('hex'), DEST = path.join(os.homedir(), 'fcode-toolkit');
let job = null, idle = Date.now();
const open = u => KEYS.openUrl(u); // fixed URLs only; Windows, macOS, Linux
const keyProg = () => PF.progress(path.join(DEST, '.fcode-keys-done.json')); // provider ids only, never keys
const json = (res, o, c = 200) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = req => new Promise(r => { let s = ''; req.on('data', c => { s += c; if (s.length > 1e5) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });

const routes = {
  'GET /api/detect': async () => { const d = W.detect(); return { d, models: W.pickLocal(d.ramGB, d.vramGB, d.freeRamGB), dest: DEST }; },
  'POST /api/browse': async () => {
    const r = cp.spawnSync('powershell', ['-NoProfile', '-STA', '-Command', "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"], { encoding: 'utf8' });
    return { path: (r.stdout || '').trim() };
  },
  'POST /api/install': async b => {
    if (job && !job.done) return { error: 'already running' };
    if (!['antigravity', 'claude'].includes(b.agent)) return { error: 'bad agent' };
    const args = [path.join(__dirname, 'setup-wizard.js'), '--agent', b.agent, '--yes'];
    if (b.project) { if (!fs.existsSync(b.project) || !fs.statSync(b.project).isDirectory()) return { error: 'That project folder does not exist.' }; args.push('--project', b.project); }
    job = { lines: [], done: false, code: null };
    const c = cp.spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NODE_TEST_CONTEXT: undefined } }); // no shell, so the path is never parsed
    const feed = d => String(d).replace(/\x1b\[[0-9;]*m/g, '').split(/[\r\n]+/).forEach(l => l.trim() && job.lines.push(l));
    c.stdout.on('data', feed); c.stderr.on('data', feed);
    c.on('close', code => { job.done = true; job.code = code; }); c.on('error', e => { job.lines.push(String(e)); job.done = true; job.code = -1; });
    return { ok: true };
  },
  'GET /api/log': async (b, q) => job ? { lines: job.lines.slice(+q.get('from') || 0), total: job.lines.length, done: job.done, code: job.code } : { lines: [], total: 0, done: false },
  'GET /api/result': async () => { try { return JSON.parse(fs.readFileSync(path.join(DEST, '.fcode-install.json'), 'utf8')); } catch { return {}; } },
  'POST /api/gateway': async () => {
    let g = (await W.probe()).gateway;
    if (g === 'down') { cp.spawn('omniroute serve', { detached: true, stdio: 'ignore', shell: true }).unref(); for (let i = 0; i < 30 && g === 'down'; i++) { await new Promise(r => setTimeout(r, 2000)); g = (await W.probe()).gateway; } }
    return { gateway: g, up: g !== 'down' && !g.startsWith('port') };
  },
  'POST /api/key': async b => {
    const k = String(b.key || '').trim(); if (!k || /\s/.test(k)) return { error: 'Paste just the key, no spaces.' };
    const r = cp.spawnSync('setx', ['OMNIROUTE_KEY', k], { stdio: 'ignore' }); // saved in your Windows user settings, nowhere else; never logged
    process.env.OMNIROUTE_KEY = k;
    const g = (await W.probe()).gateway;
    return { saved: r.status === 0, works: g.includes('key works'), gateway: g };
  },
  'POST /api/test': async () => { // one tiny message through the gateway: proves provider + OmniRoute key work together
    const k = process.env.OMNIROUTE_KEY; if (!k) return { error: 'No OmniRoute key saved yet (step 4).' };
    try {
      const r = await fetch('http://localhost:20128/v1/chat/completions', { method: 'POST', signal: AbortSignal.timeout(60000), headers: { Authorization: 'Bearer ' + k, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'auto', max_tokens: 16, messages: [{ role: 'user', content: 'Reply with OK' }] }) });
      const j = await r.json().catch(() => ({}));
      const text = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      return r.ok && Array.isArray(j.choices) ? { ok: true, reply: String(text || '(empty, but the gateway answered)').slice(0, 60) } : { error: `gateway answered ${r.status}: ${String((j.error && (j.error.message || j.error)) || 'no reply').slice(0, 160)}` };
    } catch (e) { return { error: 'could not reach OmniRoute: ' + e.message }; }
  },
  'POST /api/open': async b => {
    if (b.what === 'folder') cp.spawn('explorer', [DEST], { stdio: 'ignore' }).unref();
    else if (b.what === 'antigravity') cp.spawn(W.ideExe(), { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    else if (b.what === 'dashboard') open('http://localhost:20128/dashboard/providers');
    return { ok: true };
  },
  'GET /api/providers': async () => { const pr = keyProg(), have = KEYS.configured(); return { list: PROV.load().filter(p => p.status === 'free').map(p => ({ id: p.id, name: p.name, limits: p.plain || Object.values(p.limits)[0], rec: !!p.recommended, card: p.card, account: p.baseUrl.includes('{account_id}'), done: pr.isDone(p.id) || have.has(p.omnirouteId) })) }; },
  'POST /api/provider-open': async b => ({ url: KEYS.openKeyPage(String(b.id)) }),   // catalog URL only
  'POST /api/provider-key': async b => KEYS.addKey(String(b.id), b.key, { accountId: b.accountId ? String(b.accountId).trim() : undefined, done: keyProg().done }),   // key is tested, handed to OmniRoute on stdin, never logged
  'POST /api/quit': async () => { setTimeout(() => process.exit(0), 200); return { ok: true }; },
};

const server = http.createServer(async (req, res) => {
  idle = Date.now();
  const u = new URL(req.url, 'http://x');
  if (req.headers.host !== `127.0.0.1:${server.address().port}`) return json(res, { error: 'bad host' }, 403);
  if (req.method === 'GET' && u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8').replace('__TOKEN__', TOKEN)); }
  const h = routes[`${req.method} ${u.pathname}`];
  if (!h || req.headers['x-token'] !== TOKEN) return json(res, { error: 'not found' }, h ? 403 : 404);
  try { json(res, await h(await body(req), u.searchParams)); } catch (e) { json(res, { error: String(e.message || e) }, 500); }
});
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Setup app running at ${url}\nKeep this window open while you use it. Close it to quit.`);
  open(url);
});
setInterval(() => { if (Date.now() - idle > 30 * 60 * 1000) process.exit(0); }, 60000).unref();
