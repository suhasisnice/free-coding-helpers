#!/usr/bin/env node
'use strict';
// fcode — code changes on free models through OmniRoute, verified before they touch your tree.
//   fcode <type> "<instruction>" --files a.js,b.js [--check "npm test"] [--root dir] [--local-only] [--patch '{json}'] [--log file.jsonl]
//   fcode bench --name <run> [--jobs E1,B2] [--concurrency 3] [--patch '{json}']   (reads ../jobs.json)
//   fcode bench --spec tasks.json --root <repo> --name <run>   (own task list on a copy of a real repo; see sih-bench.example.json)
//   fcode probe <model> [--calls 40] [--parallel 10]                                  (burst-probe a ceiling)
//   fcode summary runs/<run>.jsonl
// types: edit bugfix tests refactor feature explain review
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { Router, Fatal, loadConfig } = require('./router');

const HOME = path.resolve(__dirname, '..');
const RUNS = path.join(HOME, 'runs');
const USAGE = path.join(HOME, 'usage', 'cli.jsonl');   // token counter: one row per call, one per job; `fcode summary` reads it
const CODE_TYPES = ['edit', 'bugfix', 'tests', 'refactor', 'feature'];
const TEXT_TYPES = ['explain', 'review'];

// ---------- prompts ----------
const FORMAT = {
  full: 'Reply with the COMPLETE new content of every file you change or create, each as:\nFILE: <path>\n```\n<entire file content>\n```\nDo not include unchanged files. No other text.',
  sr: 'Reply with one or more edit blocks, each as:\nFILE: <path>\n<<<<<<< SEARCH\n<lines copied exactly from the current file>\n=======\n<replacement lines>\n>>>>>>> REPLACE\nThe SEARCH text must match the file exactly (including indentation) and appear once. Keep blocks small. To create a new file use an empty SEARCH section. No other text.',
  diff: 'Reply with a unified diff only: `--- a/<path>` and `+++ b/<path>` headers, `@@` hunks with 3 lines of context. For a new file use `--- /dev/null`. No other text.',
};
const EXAMPLE = {
  full: 'Example:\nFILE: src/util.js\n```\n\'use strict\';\nfunction add(a, b) { return a + b; }\nmodule.exports = { add };\n```',
  sr: 'Example:\nFILE: src/util.js\n<<<<<<< SEARCH\nfunction add(a, b) { return a - b; }\n=======\nfunction add(a, b) { return a + b; }\n>>>>>>> REPLACE',
  diff: 'Example:\n--- a/src/util.js\n+++ b/src/util.js\n@@ -1,3 +1,3 @@\n \'use strict\';\n-function add(a, b) { return a - b; }\n+function add(a, b) { return a + b; }\n module.exports = { add };',
};
const LONG_RULES = 'Rules: change only what the task needs; keep the existing code style, CommonJS modules and exported names; do not add dependencies; keep existing behaviour that the task does not mention; make sure every file you touch still parses.';
const TYPE_HINT = {
  tests: 'Tests use only node:test and node:assert (`const test = require(\'node:test\'); const assert = require(\'node:assert\');`) and require the module by relative path, e.g. require(\'../src/x\'). Assert exact values. Do not modify the module under test.',
  review: 'List only real correctness bugs you can point to in the code. For each: the function, what goes wrong (with a concrete input), and the fix. No style remarks, no speculation.',
  explain: 'Answer in plain text. Be concrete: name the functions, the exact conditions and values, and what is returned.',
};

function systemPrompt(cls, format, type, cfg) {
  const textJob = TEXT_TYPES.includes(type);
  const parts = [cls === 'small' || cls === 'reasoning' ? 'You edit code.' : 'You are a careful senior JavaScript engineer making a precise change to a Node.js project.'];
  if (textJob) parts[0] = 'You are a senior JavaScript engineer reading a Node.js project.';
  if (TYPE_HINT[type]) parts.push(TYPE_HINT[type]);
  if (!textJob) {
    parts.push(FORMAT[format]);
    if (cfg.template === 'v2' || cls === 'small') parts.push(EXAMPLE[format]);
    if (cfg.systemPrompt === 'long') parts.push(LONG_RULES);
  }
  if (cls === 'reasoning') parts.push('Output only the final answer.');
  return parts.join('\n\n');
}

function fileBlocks(root, files, budget) {
  const docs = files.map((f) => {
    const p = path.join(root, f);
    return { f, text: fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null };
  });
  const total = docs.reduce((n, d) => n + (d.text ? d.text.length : 0), 0);
  const scale = total > budget ? budget / total : 1;   // ponytail: proportional cut, smarter trimming (by symbol) if big files show up
  return docs.map(({ f, text }) => {
    if (text == null) return `FILE: ${f} (does not exist yet — create it)`;
    const t = scale < 1 ? text.slice(0, Math.floor(text.length * scale)) + '\n... [truncated]' : text;
    return `FILE: ${f}\n\`\`\`js\n${t}\n\`\`\``;
  }).join('\n\n');
}

// ---------- parsing + applying edits ----------
function pathIn(line, files) {
  return files.find((f) => line.includes(f)) || files.find((f) => new RegExp(`(^|[\\s/\`*"'])${path.basename(f).replace(/\./g, '\\.')}\\b`).test(line));
}
function lastPathBefore(text, idx, files) {
  const lines = text.slice(0, idx).split('\n').reverse();
  for (const l of lines) { const f = pathIn(l, files); if (f) return f; }
  return files.length === 1 ? files[0] : null;
}

function parseFull(text, files) {
  const out = [];
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)\n?```/g)) {
    const f = lastPathBefore(text, m.index, files) || pathIn(m[1].split('\n')[0], files);
    if (f) out.push({ file: f, content: m[1].replace(/\s*$/, '\n') });
  }
  return out;
}
function parseSR(text, files) {
  const out = [];
  for (const m of text.matchAll(/^<{7}[ \t]*(?:SEARCH)?[^\n]*\n([\s\S]*?)\n?^={7}[ \t]*\n([\s\S]*?)\n?^>{7}[ \t]*(?:REPLACE)?[^\n]*$/gm)) {
    const f = lastPathBefore(text, m.index, files);
    if (f) out.push({ file: f, search: m[1], replace: m[2] });
  }
  return out;
}
function parseDiff(text, files) {
  const out = [];
  let file = null, isNew = false, hunk = null;
  const flush = () => { if (hunk && file) out.push(isNew ? { file, content: hunk.new.join('\n').replace(/\s*$/, '\n') } : { file, search: hunk.old.join('\n'), replace: hunk.new.join('\n') }); hunk = null; };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('```')) continue;
    if (line.startsWith('--- ')) { flush(); isNew = /\/dev\/null/.test(line); if (!isNew) file = pathIn(line, files); continue; }
    if (line.startsWith('+++ ')) { const f = pathIn(line, files); if (f) file = f; continue; }
    if (line.startsWith('@@')) { flush(); hunk = { old: [], new: [] }; continue; }
    if (!hunk) continue;
    if (line.startsWith('-')) hunk.old.push(line.slice(1));
    else if (line.startsWith('+')) hunk.new.push(line.slice(1));
    // context: normally " x", but some models (nemotron) drop the leading space, so any other line counts too
    else if (!line.startsWith('\\')) { const l = line.startsWith(' ') ? line.slice(1) : line; hunk.old.push(l); hunk.new.push(l); }
  }
  flush();
  // a new file's hunks can arrive as several @@ blocks: concatenate them
  const merged = [];
  for (const e of out) {
    const prev = merged.find((x) => x.content != null && x.file === e.file);
    if (prev && e.content != null) prev.content += e.content; else merged.push(e);
  }
  return merged;
}

function applySR(content, search, replace, file) {
  if (!search.trim()) return content ? content.replace(/\s*$/, '\n') + replace + '\n' : replace.replace(/\s*$/, '\n');
  if (content.includes(search)) return content.replace(search, () => replace);
  // fuzzy: compare line by line ignoring leading/trailing whitespace
  const lines = content.split('\n');
  const s = search.split('\n');
  while (s.length && !s[s.length - 1].trim()) s.pop();
  while (s.length && !s[0].trim()) s.shift();
  for (let i = 0; i + s.length <= lines.length; i++) {
    if (s.every((l, k) => l.trim() === lines[i + k].trim())) {
      return [...lines.slice(0, i), ...replace.split('\n'), ...lines.slice(i + s.length)].join('\n');
    }
  }
  // an overlapping block whose change an earlier block already made
  const norm = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  if (replace.trim() && norm(content).includes(norm(replace))) return content;
  throw new Error(`SEARCH text not found in ${file}: "${s[0] ? s[0].trim().slice(0, 80) : ''}"`);
}

// Applies a model reply to dir; returns changed files. Throws if nothing usable.
function applyReply(dir, reply, files, format) {
  const parsers = { full: parseFull, sr: parseSR, diff: parseDiff };
  let edits = parsers[format](reply, files);
  for (const k of Object.keys(parsers)) if (!edits.length && k !== format) edits = parsers[k](reply, files);
  if (!edits.length) throw new Error('no edit found in the reply (expected ' + format + ' format naming one of: ' + files.join(', ') + ')');
  const changed = new Set();
  for (const e of edits) {
    const p = path.join(dir, e.file);
    const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
    const next = e.content != null ? e.content : applySR(cur, e.search, e.replace, e.file);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, next);
    changed.add(e.file);
  }
  return [...changed];
}

// ---------- scratch copy + check ----------
function scratchCopy(root) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcode-'));
  // ponytail: copies the whole tree minus .git/node_modules; fine for small repos, use a git worktree for big ones
  fs.cpSync(root, dir, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules|android|ios|dist|\.expo|graphify-out|errors|public)$|\.(jpg|png|apk|aab)$/i.test(src) });
  const nm = path.join(root, 'node_modules');
  if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(dir, 'node_modules'), 'junction');
  return dir;
}

function runCheck(dir, check, env) {
  try {
    const out = execSync(check, { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000, encoding: 'utf8' });
    return { ok: true, out };
  } catch (e) {
    const out = (e.stdout || '') + (e.stderr || '') || e.message;
    const lines = out.split('\n');
    const i = lines.findIndex((l) => /^\s*not ok|Error|error:/.test(l));
    return { ok: false, out: lines.slice(Math.max(0, i)).join('\n').slice(0, 2500) };
  }
}

// ---------- deny-list: files that must never be sent to a third-party model ----------
// Built for Pinch (protected money/capture/privacy code, native module, secrets, real-SMS fixtures).
// Extra regexes, one per line, can go in <root>/.fcode-deny. A denied file aborts the job before any call.
const DENY = [
  /(^|\/)(src\/(math|db|security)|modules\/pinch-capture|android|ios)\//,
  /smsPrivacy|backupService|eraseService|captureService|parserService|classif|categoris|settlementService|financialEngine|moneyService/i,
  /parserRealWorld|parserJunk|roundTripCapture|rawEvent/i,
  /(^|\/)\.env|keystore|\.jks$|\.pem$|secret|credential|pinch-keys/i,
];
function checkDeny(root, files, localOnly = false) {
  if (localOnly) return;   // nothing leaves this machine, so the third-party deny-list does not apply
  const extra = path.join(root, '.fcode-deny');
  const rules = DENY.concat(fs.existsSync(extra) ? fs.readFileSync(extra, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => new RegExp(l)) : []);
  const hit = files.filter((f) => rules.some((r) => r.test(f)));
  if (hit.length) throw new Error('denied by fcode deny-list (protected or sensitive): ' + hit.join(', ') + ' (add --local-only to run on local Ollama only)');
}

// ---------- sensitive files: forced onto local Ollama ----------
// <root>/.fcode-local lists one regex per line; any --files match makes the whole job local-only. This is explicit, not a detector:
// it cannot see sensitive CONTENT in a file nobody listed, so real-data files must be listed there or the job run with --local-only.
function isSensitive(root, files) {
  const f = path.join(root, '.fcode-local');
  if (!fs.existsSync(f)) return false;
  const rules = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#')).map((l) => new RegExp(l));
  return files.some((x) => rules.some((r) => r.test(x)));
}

// ---------- the job loop ----------
// Token estimate. Claude's tokenizer is BPE: ~4 chars/token for prose, ~3.2 for code/JSON (symbols, short identifiers).
// Inline, Claude would: Read the files (the Read tool adds a line-number prefix, ~2 tokens/line), then write ONLY the changed
// lines (an edit sends old+new text, not the whole file), plus two tool calls. Delegating, Claude: sends one command and
// reviews the diff (changed lines + a few lines of header). Output tokens cost ~5x input, so `weighted` = in + 5*out.
// Constants are round numbers on purpose; recalibrate against the count_tokens API in phase 8 rather than tuning them here.
const CODE_EXT = /\.(js|mjs|ts|tsx|jsx|py|java|c|cpp|cs|go|rs|rb|php|json|ya?ml|sh|bat|ps1|html|css|sql|kt|swift)$/i;
const tok = (text, file) => Math.ceil(text.length / (file && CODE_EXT.test(file) ? 3.2 : 4));
function changedLines(a, b) {   // lines removed from a + lines added in b (bag compare; cheap, order-blind)
  const bag = new Map();
  for (const l of a.split('\n')) bag.set(l, (bag.get(l) || 0) + 1);
  const added = [];
  for (const l of b.split('\n')) { const n = bag.get(l) || 0; if (n) bag.set(l, n - 1); else added.push(l); }
  const removed = [].concat(...[...bag].map(([l, n]) => Array(n).fill(l)));
  return removed.concat(added).join('\n');
}
function savings({ original, instruction, edits, answer, verified }) {
  const cmdOut = tok(instruction) + 60;              // Claude writes the fcode command
  if (!verified) return { inlineIn: 0, inlineOut: 0, delegIn: 30, delegOut: cmdOut };   // wasted: Claude paid for the command and the failure line
  const readIn = Object.entries(original).reduce((n, [f, t]) => n + (t ? tok(t, f) + 2 * t.split('\n').length : 0), 0);
  const writeOut = answer != null ? tok(answer) : edits.reduce((n, e) => n + tok(changedLines(e.old, e.new), e.f), 0);
  return { inlineIn: readIn + tok(instruction), inlineOut: writeOut + 80, delegIn: writeOut + 30, delegOut: cmdOut };
}
async function runJob({ type, instruction, files, check, probe = '', root, router, cfg, log = () => {}, jobId = null, localOnly = false }) {
  localOnly = localOnly || isSensitive(root, files);
  // a sensitive job needs a router that cannot reach the cloud at all; refuse rather than trust the caller
  if (localOnly && !router.localOnly) throw new Fatal('sensitive job given a router that can reach cloud providers: refusing');
  checkDeny(root, files, localOnly);
  const t0 = Date.now();
  const isText = TEXT_TYPES.includes(type);
  const scratch = scratchCopy(root);
  const answerFile = path.join(scratch, '.fcode-answer.txt');
  const original = Object.fromEntries(files.map((f) => [f, fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : null]));
  const reset = () => { for (const [f, t] of Object.entries(original)) { const p = path.join(scratch, f); if (t == null) fs.rmSync(p, { force: true }); else fs.writeFileSync(p, t); } };
  const excludedProv = new Set(), excludedModels = new Set();
  let edits = [], answer = null;   // what the helper produced, for the token estimate
  let reason = null, attempts = 0, retries = 0, calls = 0, tokens = 0, lastProv = null, result = null, localOnlyNow = localOnly;

  const row = (r) => log({ job: jobId, type, attempt: attempts, ...r });
  const call = async (model, messages, kind) => {
    calls++;
    let meta = null;
    try {
      const res = await router.chat(model, messages, { onCall: (m) => { meta = m; } });
      tokens += res.tokens || 0;
      if (process.env.FCODE_DEBUG && !localOnly) fs.appendFileSync(path.join(process.env.FCODE_DEBUG, `${jobId || 'cli'}.txt`), `\n===== ${model} ${kind}\n${messages.at(-1).content.slice(0, 1500)}\n----- reply\n${res.text}\n`);
      return { res, meta };
    } catch (e) {
      reason = localOnly ? 'provider error' : e.message.slice(0, 160);
      if (meta) row({ model, status: meta.status, latency: meta.latency, tokens: meta.tokens, check: null, call: kind, attempt: attempts + (kind === 'fresh' ? 1 : 0), error: e.message.slice(0, 200) });
      else calls--;   // never reached the gateway (model cooling)
      throw e;
    }
  };

  try {
    while (attempts < cfg.maxAttempts) {
      let model = router.pick(type, excludedProv, excludedModels, localOnlyNow);
      if (!model && lastProv) model = router.pick(type, new Set([lastProv]), excludedModels, localOnlyNow);
      if (!model) break;
      const cls = router.info(model).class || 'mid';
      const format = router.info(model).format || 'sr';
      reset();
      const messages = [
        { role: 'system', content: systemPrompt(cls, format, type, cfg) },
        { role: 'user', content: `Task (${type}): ${instruction}\n\n${fileBlocks(scratch, files, cfg.contextBudget)}${probe ? '\n\nObserved output from the real code (use these exact values, do not guess):\n```\n' + probe + '\n```' : ''}` },
      ];
      let first;
      try { first = await call(model, messages, 'fresh'); } catch (e) {
        if (e instanceof Fatal) throw e;
        excludedModels.add(model); router.stats.failovers++;
        // out of retries: one last try on local Ollama (if the chain has it) instead of giving up
        if (++retries > cfg.maxRetries) { if (localOnlyNow) break; localOnlyNow = true; }
        continue;
      }
      attempts++;
      let { res, meta } = first;
      for (let round = 0; round < (isText ? 1 : 2); round++) {
        let verdict, changed = [];
        if (isText) {
          fs.writeFileSync(answerFile, res.text);
          verdict = check ? runCheck(scratch, check, { FCODE_ANSWER: answerFile }) : { ok: !!res.text.trim(), out: 'empty answer' };
        } else {
          try {
            changed = applyReply(scratch, res.text, files, format);
            verdict = runCheck(scratch, check || changed.filter((f) => f.endsWith('.js')).map((f) => `node --check "${f}"`).join(' && ') || 'node -e 0', { FCODE_ANSWER: answerFile });
          } catch (e) { verdict = { ok: false, out: 'could not apply the edit: ' + e.message, applyError: true, why: e.message.split(/[:"]/)[0].slice(0, 80) }; }
        }
        if (!verdict.ok) reason = localOnly ? (verdict.applyError ? 'edit not applicable' : 'check failed') : (verdict.applyError ? 'edit not applicable' : 'check failed: ' + verdict.out.split('\n')[0].slice(0, 100));
        row({ model, status: meta.status, latency: meta.latency, tokens: meta.tokens, check: verdict.ok ? 'pass' : (verdict.applyError ? 'apply-error' : 'fail'), call: round ? 'feedback' : 'fresh', ...(verdict.why ? { why: verdict.why } : {}) });
        if (verdict.ok) {
          if (!isText) for (const f of files) {
            const s = path.join(scratch, f);
            if (fs.existsSync(s) && fs.readFileSync(s, 'utf8') !== (original[f] ?? '')) { edits.push({ f, old: original[f] ?? '', new: fs.readFileSync(s, 'utf8') }); fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true }); fs.copyFileSync(s, path.join(root, f)); }
          }
          if (isText) answer = res.text;
          result = { verified: true, model, answer: isText ? res.text : null };
          return result;
        }
        if (isText || round === 1) break;
        // feed the error back once, to the same model, on top of its own attempt
        const current = files.filter((f) => fs.existsSync(path.join(scratch, f)));
        messages.push({ role: 'assistant', content: res.text });
        messages.push({ role: 'user', content: `${verdict.applyError ? verdict.out : 'The check `' + (check || 'node --check') + '` failed:\n```\n' + verdict.out + '\n```'}\n\nCurrent file contents:\n\n${fileBlocks(scratch, current, cfg.contextBudget)}\n\nFix it. Reply in the same format as before, relative to the current contents above.` });
        try { ({ res, meta } = await call(model, messages, 'feedback')); } catch (e) { if (e instanceof Fatal) throw e; break; }
      }
      excludedProv.add(router.provider(model)); excludedModels.add(model); lastProv = router.provider(model);
    }
    result = { verified: false };
    return result;
  } finally {
    log({ event: 'job', job: jobId, type, status: result && result.verified ? 'verified' : 'failed', model: result && result.model || null, attempts, calls, tokens, wall: Date.now() - t0, ...savings({ original, instruction, edits, answer, verified: !!(result && result.verified) }), ...(result && result.verified ? {} : { reason }) });
    fs.rmSync(scratch, { recursive: true, force: true });
    if (result) Object.assign(result, { attempts, calls, tokens, wall: Date.now() - t0 });
  }
}

// ---------- run logs ----------
function callsUsed() {
  if (!fs.existsSync(RUNS)) return 0;
  let n = 0;
  for (const f of fs.readdirSync(RUNS).filter((f) => f.endsWith('.jsonl'))) {
    for (const l of fs.readFileSync(path.join(RUNS, f), 'utf8').split('\n')) if (l && !l.includes('"event":"job"')) n++;
  }
  return n;
}
function logger(file) {
  if (!file) return () => {};
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return (r) => fs.appendFileSync(file, JSON.stringify({ t: new Date().toISOString(), ...r }) + '\n');
}

const sum = (rows, f) => rows.reduce((n, r) => n + f(r), 0);
function summarize(rows) {
  const jobs = rows.filter((r) => r.event === 'job');
  const callRows = rows.filter((r) => !r.event);
  const ok = jobs.filter((j) => j.status === 'verified');
  const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  const byType = {};
  for (const j of jobs) {
    const t = (byType[j.type] = byType[j.type] || { jobs: 0, verified: 0, within3: 0, models: {} });
    t.jobs++;
    if (j.status === 'verified') { t.verified++; if (j.attempts <= 3) t.within3++; t.models[j.model] = (t.models[j.model] || 0) + 1; }
  }
  for (const t of Object.values(byType)) {
    t.pct = Math.round((100 * t.within3) / t.jobs);
    t.top = Object.entries(t.models).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    delete t.models;
  }
  return {
    jobs: jobs.length, verified: ok.length,
    attemptsPerVerified: ok.length ? +(ok.reduce((n, j) => n + j.attempts, 0) / ok.length).toFixed(2) : null,
    callsPerVerified: ok.length ? +(callRows.length / ok.length).toFixed(2) : null,
    claudeTokensAvoided: sum(jobs, (j) => (j.inlineIn || 0) + (j.inlineOut || 0)),
    claudeTokensSpent: sum(jobs, (j) => (j.delegIn || 0) + (j.delegOut || 0)),   // command + review, incl. failed jobs
    netClaudeTokensSaved: sum(jobs, (j) => (j.inlineIn || 0) + (j.inlineOut || 0) - (j.delegIn || 0) - (j.delegOut || 0)),
    netWeightedSaved: sum(jobs, (j) => (j.inlineIn || 0) + 5 * (j.inlineOut || 0) - (j.delegIn || 0) - 5 * (j.delegOut || 0)),   // output counts 5x
    helperTokensUsed: callRows.reduce((n, r) => n + (r.tokens || 0), 0),
    tokensPerVerified: ok.length ? Math.round(callRows.reduce((n, r) => n + (r.tokens || 0), 0) / ok.length) : null,
    calls: callRows.length,
    r429: callRows.filter((r) => r.status === 429).length,
    failovers: callRows.filter((r) => r.status !== 200).length,
    medianWallSec: jobs.length ? Math.round(med(jobs.map((j) => j.wall)) / 1000) : null,
    byType,
  };
}

// ---------- CLI ----------
function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
    else o._.push(argv[i]);
  }
  return o;
}

// `fcode validate [--spec f] [--root dir]`: every task's check must FAIL on the untouched project (else the task proves nothing),
// plus size tags (files, chars) for phase 8's limits, plus any task no model ever solved in runs/ (check may be broken or too hard).
function validate(o) {
  const spec = JSON.parse(fs.readFileSync(o.spec ? path.resolve(o.spec) : path.join(HOME, 'jobs.json'), 'utf8'));
  const root = o.root ? path.resolve(o.root) : path.join(HOME, spec.root);
  const solved = new Set();
  if (fs.existsSync(RUNS)) for (const f of fs.readdirSync(RUNS).filter((f) => f.endsWith('.jsonl')))
    for (const l of fs.readFileSync(path.join(RUNS, f), 'utf8').split('\n')) { if (l.includes('"event":"job"') && l.includes('"status":"verified"')) solved.add(JSON.parse(l).job); }
  let bad = 0;
  for (const j of spec.jobs) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fcode-val-'));
    fs.cpSync(root, work, { recursive: true, filter: (src) => !/[\/](\.git|node_modules)$/.test(src) });
    const ans = path.join(work, '.fcode-answer.txt'); fs.writeFileSync(ans, '');
    const r = runCheck(work, j.check, { FCODE_ANSWER: ans });
    const chars = j.files.reduce((n, f) => n + (fs.existsSync(path.join(root, f)) ? fs.statSync(path.join(root, f)).size : 0), 0);
    fs.rmSync(work, { recursive: true, force: true });
    const flags = [r.ok ? 'CHECK PASSES BEFORE (useless task)' : '', solved.size && !solved.has(j.id) ? 'never solved by any model' : ''].filter(Boolean);
    if (r.ok) bad++;
    console.log(`${j.id.padEnd(3)} ${j.type.padEnd(8)} files=${j.files.length} chars=${String(chars).padStart(6)}  ${flags.join('; ') || 'ok'}`);
  }
  console.log(`${spec.jobs.length} tasks, ${bad} with a check that already passes`);
  if (bad) process.exitCode = 1;
}

// `fcode report <prefix> [--out file.md]`: one row per model from runs/<prefix>*.jsonl (pinned runs, see bench --model).
function report(o) {
  const prefix = o._[1]; if (!prefix) throw new Error('usage: fcode report <run-name-prefix> [--out results.md]');
  const rows = [];
  for (const f of fs.readdirSync(RUNS).filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl'))) {
    const rs = fs.readFileSync(path.join(RUNS, f), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    const model = (rs.find((r) => r.model) || {}).model || f.slice(prefix.length).replace(/\.jsonl$/, '');
    const jobs = rs.filter((r) => r.event === 'job'), calls = rs.filter((r) => !r.event);
    const lat = calls.filter((r) => r.status === 200).map((r) => r.latency).sort((a, b) => a - b);
    const byType = {};
    for (const j of jobs) { const t = (byType[j.type] = byType[j.type] || [0, 0]); t[1]++; if (j.status === 'verified') t[0]++; }
    const reasons = {};
    for (const j of jobs.filter((j) => j.status !== 'verified')) { const k = (j.reason || 'unknown').slice(0, 40); reasons[k] = (reasons[k] || 0) + 1; }
    rows.push({ model, jobs: jobs.length, ok: jobs.filter((j) => j.status === 'verified').length, r429: calls.filter((r) => r.status === 429).length,
      errs: calls.filter((r) => r.status !== 200 && r.status !== 429).length, med: lat.length ? Math.round(lat[Math.floor((lat.length - 1) / 2)] / 1000) : null,
      tokens: calls.reduce((n, r) => n + (r.tokens || 0), 0), byType, reasons });
  }
  rows.sort((a, b) => b.ok / (b.jobs || 1) - a.ok / (a.jobs || 1));
  const types = [...new Set(rows.flatMap((r) => Object.keys(r.byType)))].sort();
  let md = `# Benchmark results: ${prefix}\n\nEach model ran alone (no failover): one fresh try plus one feedback round per task.\n\n| model | passed | ` + types.join(' | ') + ' | median s | 429s | other errors | tokens |\n|' + '---|'.repeat(types.length + 6) + '\n';
  for (const r of rows) md += `| ${r.model} | ${r.ok}/${r.jobs} | ` + types.map((t) => (r.byType[t] ? r.byType[t].join('/') : '-')).join(' | ') + ` | ${r.med ?? '-'} | ${r.r429} | ${r.errs} | ${r.tokens} |\n`;
  md += '\n## Why jobs failed\n' + rows.map((r) => `- ${r.model}: ` + (Object.entries(r.reasons).map(([k, v]) => `${k} x${v}`).join('; ') || 'none')).join('\n') + '\n';
  if (o.out) fs.writeFileSync(path.resolve(o.out), md);
  console.log(md);
}

async function bench(o, cfg) {
  // default: the sandbox fixture in ../jobs.json. --spec <file> [--root <repo>] runs a task list on any project (always on a copy; your tree is never touched).
  // --model <id> pins every task to that one model (no failover; it gets its fresh try + one feedback round), so each model is graded on its own
  if (o.model) {
    if (!cfg.models[o.model]) throw new Error(`unknown model ${o.model}; see "models" in router.config.json`);
    cfg = { ...cfg, chains: Object.fromEntries(Object.keys(cfg.chains).map((t) => [t, [o.model]])) };
  }
  const spec = JSON.parse(fs.readFileSync(o.spec ? path.resolve(o.spec) : path.join(HOME, 'jobs.json'), 'utf8'));
  const root = o.root ? path.resolve(o.root) : path.join(HOME, spec.root);
  const want = o.jobs ? String(o.jobs).split(',') : null;
  const jobs = spec.jobs.filter((j) => !want || want.includes(j.id));
  const file = path.join(RUNS, `${o.name}.jsonl`);
  if (fs.existsSync(file)) throw new Error(`${file} exists — pick a new --name`);
  const log = logger(file);
  cfg.callsUsed = callsUsed();
  const router = new Router(cfg);
  let localRouter = null;   // built only if a task is sensitive, so a cloud-free machine can still run those
  console.log(`bench ${o.name}: ${jobs.length} jobs, calls used so far ${cfg.callsUsed}/${cfg.callCap}`);
  const queue = [...jobs];
  let fatal = null;
  const worker = async () => {
    while (queue.length && !fatal) {
      const j = queue.shift();
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fcode-bench-'));
      fs.cpSync(root, work, { recursive: true, filter: (src) => !/[\\/](\.git|node_modules)$/.test(src) });
      try {
        const lo = !!j.localOnly || isSensitive(work, j.files);
        const rt = lo ? (localRouter = localRouter || new Router(cfg, { localOnly: true })) : router;
        const r = await runJob({ type: j.type, instruction: j.instruction, files: j.files, check: j.check, root: work, router: rt, cfg, log, jobId: j.id, localOnly: lo });
        console.log(`${j.id.padEnd(3)} ${j.type.padEnd(8)} ${r.verified ? 'VERIFIED' : 'failed  '} ${String(r.model || '-').padEnd(34)} attempts=${r.attempts} calls=${r.calls} ${Math.round(r.wall / 1000)}s`);
      } catch (e) {
        if (e instanceof Fatal) fatal = e; else console.log(`${j.id} error: ${e.message}`);
      } finally { fs.rmSync(work, { recursive: true, force: true }); }
    }
  };
  await Promise.all(Array.from({ length: +o.concurrency || 3 }, worker));
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  console.log(JSON.stringify(summarize(rows), null, 1));
  if (fatal) { console.error('STOPPED: ' + fatal.message); process.exitCode = 3; }
}

async function probe(o, cfg) {
  const model = o._[1];
  const calls = +o.calls || 40, par = +o.parallel || 10;
  cfg.models[model] = { ...(cfg.models[model] || {}), rpm: 1e6, concurrency: par };
  cfg.breaker = { fails: 1e6, coolSec: 0 };
  cfg.callsUsed = callsUsed();
  if (cfg.callsUsed + calls > cfg.callCap) throw new Error('probe would exceed the call cap');
  const router = new Router(cfg);
  const log = logger(path.join(RUNS, `probe-${model.replace(/[^\w.-]+/g, '_')}.jsonl`));
  let sent = 0, ok = 0, stop = null;
  const t0 = Date.now();
  const one = async () => {
    while (sent < calls && !stop) {
      sent++;
      let meta = null;
      try {
        await router.chat(model, [{ role: 'user', content: 'Reply with the word OK.' }], { maxTokens: 8, onCall: (m) => { meta = m; } });
        ok++;
      } catch (e) {
        if (e instanceof Fatal) throw e;
        stop = stop || `${meta ? meta.status : '?'} after ${ok} ok: ${e.message.slice(0, 160)}`;
      } finally { if (meta) log({ job: 'probe', type: 'probe', model, status: meta.status, latency: meta.latency, tokens: meta.tokens, check: null, attempt: 0 }); }
    }
  };
  await Promise.all(Array.from({ length: par }, one));
  const sec = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ model, sent, ok, seconds: +sec.toFixed(1), okPerMin: +((ok / Math.max(sec, 1)) * 60).toFixed(1), stoppedBy: stop }));
}

async function main() {
  const o = args(process.argv.slice(2));
  const cfg = loadConfig(o.patch ? JSON.parse(o.patch) : null);
  const cmd = o._[0];
  if (cmd === 'report') return report(o);
  if (cmd === 'validate') return validate(o);
  if (cmd === 'bench') return bench(o, cfg);
  if (cmd === 'probe') return probe(o, cfg);
  if (cmd === 'summary') return console.log(JSON.stringify(summarize(fs.readFileSync(o._[1] || USAGE, 'utf8').trim().split('\n').map(JSON.parse)), null, 1));
  if (![...CODE_TYPES, ...TEXT_TYPES].includes(cmd) || !o._[1] || !o.files) {
    console.error('usage: fcode <edit|bugfix|tests|refactor|feature|explain|review> "<instruction>" --files a.js,b.js [--check "npm test"]');
    process.exit(2);
  }
  try { // phase-8 rules from the latest benchmark: a warning, never a block
    const t = JSON.parse(fs.readFileSync(path.join(__dirname, 'rules.json'), 'utf8')).types[cmd];
    if (t && !t.delegate) console.error(`note: the benchmark says ${cmd} jobs pass only ${t.ranked[0] ? Math.round(t.ranked[0].rate * 100) + '%' : 'rarely'} of the time; doing it inline may be cheaper.`);
  } catch {}
  const root = path.resolve(o.root || '.');
  const files = String(o.files).split(',').map((f) => path.relative(root, path.resolve(root, f.trim())).split(path.sep).join('/'));
  if (files.some((f) => f.startsWith('..'))) throw new Error('--files must be inside the project root');
  if (o.log) cfg.callsUsed = callsUsed();
  const localOnly = !!o['local-only'] || process.env.FCODE_LOCAL_ONLY === '1' || isSensitive(root, files);
  const router = new Router(cfg, { localOnly });
  const probe = o.probe ? String(require('child_process').spawnSync(o.probe, { cwd: root, shell: true, encoding: 'utf8', timeout: 60000 }).stdout || '').slice(0, 3000) : '';
  const r = await runJob({ type: cmd, instruction: o._[1], files, check: o.check, probe, root, router, cfg, localOnly, log: logger(o.log ? path.resolve(o.log) : USAGE) });   // every CLI run is counted by default (outside runs/ so bench call caps are unaffected)
  if (r.answer) console.log(r.answer + '\n');
  if (localOnly) console.log('(local-only: nothing was sent to a cloud provider)');
  if (r.verified) console.log(`✔ ${TEXT_TYPES.includes(cmd) ? 'answered' : 'applied'} by ${r.model} (attempts ${r.attempts}, calls ${r.calls}, ${Math.round(r.wall / 1000)}s)`);
  else { console.log(`✘ not verified after ${r.attempts} attempts / ${r.calls} calls — working tree untouched`); process.exitCode = 1; }
}

if (require.main === module) main().catch((e) => { console.error((e instanceof Fatal ? 'STOPPED: ' : 'error: ') + e.message); process.exit(3); });
module.exports = { checkDeny, isSensitive, applyReply, parseFull, parseSR, parseDiff, applySR, summarize, runJob };
