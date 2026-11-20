'use strict';
// Model router for the OmniRoute gateway: per-model token buckets, 429 cooldowns,
// a 5xx/timeout circuit breaker, per-model concurrency, and the hard safety stops.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Never printed, logged or written anywhere.
function readKey() {
  if (process.env.OMNIROUTE_KEY) return process.env.OMNIROUTE_KEY;
  if (process.platform === 'win32') {
    try {
      const out = execSync('reg query HKCU\\Environment /v OMNIROUTE_KEY', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(/OMNIROUTE_KEY\s+REG_\w+\s+(\S+)/);
      if (m) return m[1];
    } catch {}
  }
  throw new Error('OMNIROUTE_KEY is not set (env or HKCU\\Environment)');
}

function deepMerge(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    a[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? deepMerge({ ...a[k] }, v) : v;
  }
  return a;
}

function loadConfig(patch) {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'router.config.json'), 'utf8'));
  const never = cfg.never;
  deepMerge(cfg, patch);
  cfg.never = [...new Set([...never, ...(Array.isArray(cfg.never) ? cfg.never : [])])];   // a patch may add to the paid-model list, never remove from it
  return cfg;
}

// Thrown for conditions that must stop the whole run (402/paid/quota, error-rate window, 40 errors in a row).
class Fatal extends Error {}

class Router {
  // localOnly: this router can only reach local Ollama. It never loads the gateway key, so a cloud call cannot be made even by mistake.
  constructor(cfg, { log, localOnly = false } = {}) {
    this.cfg = cfg;
    this.localOnly = localOnly;
    this.key = localOnly ? null : readKey();
    this.state = {};      // model -> { tokens, last, inflight, coolUntil, fails, cool429 }
    this.window = [];     // last 50 call outcomes for the error-rate stop
    this.errStreak = 0;
    this.log = log || (() => {});
    this.stats = { calls: 0, r429: 0, failovers: 0 };
    // Rolling 24 h call log per model ([timestamp, tokens]), kept in a file so per-hour and per-day limits survive between runs.
    this.usageDir = process.env.FCODE_USAGE_DIR || path.join(__dirname, 'limits-state');   // one file per model, so parallel runs on different models never overwrite each other
    this.usage = {};
  }

  usageFile(model) { return path.join(this.usageDir, model.replace(/[^a-z0-9.-]+/gi, '_') + '.json'); }
  loadUse(model) {
    if (this.usage[model]) return this.usage[model];
    try { return (this.usage[model] = this.localOnly ? [] : JSON.parse(fs.readFileSync(this.usageFile(model), 'utf8'))); } catch { return (this.usage[model] = []); }
  }

  // Calls and tokens this model has used in the last `ms`, plus the time until enough of them age out (see waitFor).
  windowUse(model, ms) {
    const now = Date.now(), ev = this.loadUse(model).filter((e) => e[0] > now - ms);
    return { calls: ev.length, tokens: ev.reduce((a, e) => a + e[1], 0), ev };
  }

  logUse(model, tokens) {
    const local = this.localOnly || this.isLocal(model);
    let disk = [];
    if (!local) try { disk = JSON.parse(fs.readFileSync(this.usageFile(model), 'utf8')); } catch {}   // pick up calls other processes logged meanwhile
    const mine = this.loadUse(model).filter((e) => e[0] > Date.now() - 86400000);
    const seen = new Set(mine.map((e) => e[0]));
    const ev = (this.usage[model] = [...mine, ...disk.filter((e) => !seen.has(e[0]) && e[0] > Date.now() - 86400000)].sort((a, b) => a[0] - b[0]));
    ev.push([Date.now(), tokens || 0]);
    if (local) return;
    try { fs.mkdirSync(this.usageDir, { recursive: true }); fs.writeFileSync(this.usageFile(model), JSON.stringify(ev)); } catch {}
  }

  // ms until the model's published limits (rpm/tpm/rph/rpd/tpd, times limitSafety) leave room for one more call of ~need tokens. 0 = fine now.
  limitWait(model, need) {
    const lim = this.info(model).limits;
    if (!lim) return 0;
    const sf = this.cfg.limitSafety || 0.8, now = Date.now();
    let wait = 0;
    for (const [calls, toks, ms] of [[lim.rpm, lim.tpm, 60000], [lim.rph, lim.tph, 3600000], [lim.rpd, lim.tpd, 86400000]]) {
      if (!calls && !toks) continue;
      const { calls: c, tokens: t, ev } = this.windowUse(model, ms);
      const overCalls = calls ? c + 1 - Math.floor(calls * sf) : 0;
      const overToks = toks ? t + need - Math.floor(toks * sf) : 0;
      if (overCalls <= 0 && overToks <= 0) continue;
      // wait until enough old events leave the window: enough calls AND enough tokens
      let freeC = 0, freeT = 0, at = 0;
      for (const e of ev) { freeC++; freeT += e[1]; at = e[0] + ms - now; if (freeC >= overCalls && freeT >= overToks) break; }
      wait = Math.max(wait, at > 0 ? at : 0);
    }
    return wait;
  }

  // Groq-style headers ("2m59.5s", "7.6s", "1h2m"): seconds
  static secs(v) {
    if (!v) return 0;
    let t = 0; for (const m of String(v).matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) t += +m[1] * ({ ms: 0.001, h: 3600, m: 60, s: 1 })[m[2]];
    return t || +v || 0;
  }

  provider(model) { return model.split('/')[0]; }
  info(model) { return this.cfg.models[model] || {}; }

  isLocal(model) { return model.startsWith('local/') && !!this.info(model).local; }

  blocked(model) {
    // lowercase + one spelling of the ollama cloud prefix, so 'OllamaCloud/' or 'ollama-cloud/' can't dodge the list
    const norm = (x) => x.toLowerCase().replace(/^ollama[-_]cloud\//, 'ollamacloud/');
    const m = norm(model);
    const p = (x) => m.startsWith(norm(x));
    if (this.cfg.never.some(p)) return 'never-call list';
    if (this.cfg.gated.some(p) && !(this.cfg.allow || []).some(p)) return 'gated';
    if (this.localOnly && !this.isLocal(model)) return 'local-only mode';
    return null;
  }

  st(model) {
    if (!this.state[model]) {
      const cap = Math.max(1, Math.floor((this.info(model).rpm || this.cfg.defaultRpm) * this.cfg.safety));
      this.state[model] = { cap, tokens: cap, last: Date.now(), inflight: 0, coolUntil: 0, fails: 0 };
    }
    const s = this.state[model];
    const now = Date.now();
    s.tokens = Math.min(s.cap, s.tokens + ((now - s.last) / 60000) * s.cap);
    s.last = now;
    return s;
  }

  // ms until this model can take a call (Infinity if cooled for longer than we want to wait)
  waitFor(model, need) {
    const s = this.st(model);
    const conc = this.info(model).concurrency || this.cfg.defaultConcurrency;
    if (s.coolUntil > Date.now()) return s.coolUntil - Date.now();
    if (s.inflight >= conc) return 2000;
    const lw = this.limitWait(model, need || this.needTokens(model));
    if (lw > 0) return lw;
    return s.tokens >= 1 ? 0 : ((1 - s.tokens) / s.cap) * 60000;
  }

  // expected size of the next call: the model's recent average, else 3000
  needTokens(model) {
    const ev = this.loadUse(model).slice(-10).filter((e) => e[1]);
    return ev.length ? Math.ceil(ev.reduce((a, e) => a + e[1], 0) / ev.length) : 3000;
  }

  // First model in the type's chain whose provider isn't excluded; prefers one that is ready now.
  pick(type, excludeProviders = new Set(), excludeModels = new Set(), onlyLocal = false) {
    const chain = (this.cfg.chains[type] || this.cfg.chains.edit)
      .filter((m) => !this.blocked(m) && !excludeModels.has(m) && !excludeProviders.has(this.provider(m)) && (!onlyLocal || this.isLocal(m)));
    if (!chain.length) return null;
    const ready = chain.find((m) => this.waitFor(m) === 0);
    if (ready) return ready;
    return chain.reduce((a, b) => (this.waitFor(b) < this.waitFor(a) ? b : a));
  }

  record(model, ok, rateLimited) {
    const nonRate = !ok && !rateLimited && !(this.provider(model) === 'gemini' && this.lastStatus >= 500);
    this.window.push(nonRate ? 1 : 0);
    if (this.window.length > 50) this.window.shift();
    this.errStreak = ok ? 0 : this.errStreak + 1;
    if (this.window.length === 50 && this.window.reduce((a, b) => a + b) > 15) {
      throw new Fatal(`>30% of the last 50 calls failed with non-429 errors (last: ${this.lastError})`);
    }
    if (this.errStreak >= 40) throw new Fatal(`40 consecutive call errors (last: ${this.lastError})`);
  }

  // Is the local Ollama server up and does it have this model installed? Cached 30 s. A "no" benches the model for the breaker time,
  // so an absent endpoint is probed once per cooldown, not once per job.
  async localReady(model) {
    const s = this.st(model);
    if (s.ready && s.ready.until > Date.now()) return s.ready.why;
    let why = null;
    try {
      const res = await fetch((this.cfg.localEndpoint || 'http://localhost:11434') + '/api/tags', { signal: AbortSignal.timeout(2000) });
      const names = ((await res.json()).models || []).map((m) => m.name);
      if (!names.includes(model.slice('local/'.length))) why = `model ${model.slice(6)} is not installed in local Ollama`;
    } catch { why = 'local Ollama is not reachable'; }
    s.ready = { until: Date.now() + 30000, why };
    if (why) s.coolUntil = Date.now() + this.cfg.breaker.coolSec * 1000;
    return why;
  }

  // One chat completion. Returns { text, tokens, latency, status }.
  // Throws { retry: true } for 429/5xx/timeout (caller fails over), Fatal for stop conditions.
  async chat(model, messages, { maxTokens, onCall } = {}) {
    const why = this.blocked(model);
    if (why) throw new Fatal(`refusing to call ${model}: ${why}`);
    if (this.cfg.callsUsed != null && this.cfg.callsUsed >= this.cfg.callCap) throw new Fatal(`call cap ${this.cfg.callCap} reached`);
    const local = this.isLocal(model);
    if (local) {
      const why = await this.localReady(model);
      if (why) throw Object.assign(new Error(`${model}: ${why}`), { retry: true, noCall: true });
    }
    // Groq counts prompt + max_tokens against tokens/min: a request bigger than the whole minute's allowance can never succeed there
    const est = Math.ceil(JSON.stringify(messages).length / 3.2) + (maxTokens || this.cfg.maxTokens);
    const tpm = (this.info(model).limits || {}).tpm;
    if (tpm && est > tpm) throw Object.assign(new Error(`${model}: request of ~${est} tokens is over its ${tpm} tokens/min limit`), { retry: true, noCall: true });
    let w;
    while ((w = this.waitFor(model, est)) > 0) {
      if (w > 90000) throw Object.assign(new Error(`${model} cooling for ${Math.round(w / 1000)}s`), { retry: true, noCall: true });
      await sleep(Math.min(w, 5000));
    }
    const s = this.st(model);
    const info = this.info(model);
    s.tokens -= 1; s.inflight++;
    this.stats.calls++; if (this.cfg.callsUsed != null) this.cfg.callsUsed++;
    const stream = this.cfg.stream === true || (Array.isArray(this.cfg.stream) && this.cfg.stream.includes(model));
    const lbody = { model: model.slice(6), messages, stream: false, options: { temperature: 0.2, num_ctx: info.numCtx || 16384, num_predict: maxTokens || this.cfg.maxTokens } };
    const body = { model, messages, max_tokens: maxTokens || this.cfg.maxTokens, temperature: 0.2, stream, ...(stream && { stream_options: { include_usage: true } }), ...(info.body || {}) };
    const t0 = Date.now();
    let status = 0, text = '', tokens = null, errText = '', retryAfter = 0, hdr = null;
    try {
      // local models go straight to Ollama's native API (the OpenAI-style one cannot set num_ctx, and Ollama's default 4k window would silently cut the prompt)
      const res = await fetch(local ? (this.cfg.localEndpoint || 'http://localhost:11434') + '/api/chat' : this.cfg.gateway + '/chat/completions', {
        method: 'POST',
        headers: local ? { 'content-type': 'application/json' } : { 'content-type': 'application/json', authorization: 'Bearer ' + this.key },
        body: JSON.stringify(local ? lbody : body),
        signal: AbortSignal.timeout((info.timeoutSec || this.cfg.timeoutSec) * 1000),
      });
      status = res.status;
      retryAfter = +res.headers.get('retry-after') || 0;
      hdr = { remT: res.headers.get('x-ratelimit-remaining-tokens'), resT: res.headers.get('x-ratelimit-reset-tokens'), remR: res.headers.get('x-ratelimit-remaining-requests'), resR: res.headers.get('x-ratelimit-reset-requests') };
      if (local && res.ok) {
        const j = JSON.parse(await res.text());
        text = j.message?.content || '';
        tokens = (j.prompt_eval_count || 0) + (j.eval_count || 0) || null;
        if (j.done_reason === 'length') { status = 0; errText = 'truncated'; }   // cut at num_predict: a half-written file must not be applied
        else if (!text) errText = 'empty reply';
      } else if (res.ok && stream) {
        let finished = false;
        for (const line of (await res.text()).split('\n')) {
          if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
          try {
            const j = JSON.parse(line.slice(5));
            if (j.error) { errText = JSON.stringify(j.error).slice(0, 500); status = /rate.?limit|429/i.test(errText) ? 429 : +j.error.code || +j.error.status || 502; }
            text += j.choices?.[0]?.delta?.content || '';
            if (j.choices?.[0]?.finish_reason) finished = true;
            if (j.usage) tokens = j.usage.total_tokens;
          } catch {}
        }
        // a stream the gateway drops mid-answer still says 200: treat it as a transient failure, not a reply
        if (!finished && !errText) { status = 0; errText = 'stream cut'; }
      } else {
        const raw = await res.text();
        if (res.ok) {
          const j = JSON.parse(raw);
          text = j.choices?.[0]?.message?.content || '';
          tokens = j.usage?.total_tokens ?? null;
          if (!j.choices) errText = raw.slice(0, 500);
        } else errText = raw.slice(0, 500);
      }
    } catch (e) {
      errText = e.name === 'TimeoutError' ? 'timeout' : e.message;
    } finally { s.inflight--; }
    const latency = Date.now() - t0;
    if (!local) this.logUse(model, tokens || Math.ceil(JSON.stringify(messages).length / 3.2 + text.length / 4));
    // if the provider says the minute's tokens/requests are nearly gone, wait for its own reset instead of finding out with a 429
    if (hdr && hdr.remT != null && +hdr.remT < this.needTokens(model)) s.coolUntil = Math.max(s.coolUntil, Date.now() + Router.secs(hdr.resT) * 1000);
    if (hdr && hdr.remR != null && +hdr.remR < 1) s.coolUntil = Math.max(s.coolUntil, Date.now() + Router.secs(hdr.resR) * 1000);
    this.lastStatus = status; this.lastError = `${model} ${status} ${errText.slice(0, 200)}`;
    onCall && onCall({ model, status: status || (errText === 'timeout' || errText === 'stream cut' ? errText.replace(' ', '-') : 'neterr'), latency, tokens });

    // A Gemini 429 always says "exceeded your current quota". That is a normal rate limit (cool the model, fail over), not the paid/quota
    // stop rule; 402 and "paid"/"quota" text on any other status or provider stay Fatal.
    const geminiLimit = status === 429 && this.provider(model) === 'gemini';
    if (status === 402 || (errText && !geminiLimit && /paid|quota/i.test(errText))) {
      throw new Fatal(`STOP: ${model} returned ${status}: ${errText.slice(0, 300)}`);
    }
    if (status === 429) {
      this.stats.r429++;
      let reset = 60;
      const m = errText.match(/reset after (\d+(?:\.\d+)?)\s*s/i) || errText.match(/reset_seconds"?\s*[:=]\s*"?(\d+(?:\.\d+)?)/) || errText.match(/retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s/i) || errText.match(/(?:retry|try again).{0,10}?(?:(\d+)m)?(\d+(?:\.\d+)?)\s*s/i);
      if (m) reset = Math.ceil(m.length > 2 ? (+m[1] || 0) * 60 + +m[2] : +m[1]);
      if (retryAfter) reset = Math.ceil(retryAfter);
      // Groq's daily token cap (TPD) says "tokens per day"; never wait less than 10 min on it
      if (/per day|\(TPD\)|\(RPD\)/i.test(errText)) reset = Math.max(reset, 600);
      // Gemini's daily free-tier bucket (quotaId ...PerDay...): don't re-probe a spent day quota more than hourly
      if (geminiLimit && /PerDay/i.test(errText)) reset = Math.max(reset, 3600);
      try {   // evidence for tuning: what we had used in each window when the provider said stop
        const u = [60000, 3600000, 86400000].map((ms) => this.windowUse(model, ms)).map((w) => `${w.calls}c/${w.tokens}t`);
        fs.appendFileSync(process.env.FCODE_USAGE_DIR ? path.join(this.usageDir, '429.log') : path.join(__dirname, '..', 'limits-429.log'), `${new Date().toISOString()} ${model} reset=${reset}s used(min/hr/day)=${u.join(' ')} msg=${errText.slice(0, 140).replace(/\s+/g, ' ')}
`);
      } catch {}
      s.coolUntil = Date.now() + reset * 1000;
      s.tokens = 0;
      this.record(model, false, true);
      throw Object.assign(new Error(`${model} 429, cooling ${reset}s: ${errText.slice(0, 160)}`), { retry: true });
    }
    if (status >= 500 || !status) {
      if (local && !status && errText !== 'truncated') s.fails = this.cfg.breaker.fails;   // dead local endpoint: bench at once, don't hammer it
      if (++s.fails >= this.cfg.breaker.fails) { s.coolUntil = Date.now() + this.cfg.breaker.coolSec * 1000; s.fails = 0; }
      this.record(model, false, false);
      throw Object.assign(new Error(`${model} ${status || ''} ${errText.slice(0, 200)}`.trim()), { retry: true });
    }
    if (status >= 400 || errText) {
      // bad or missing credentials do not fix themselves: bench the model instead of trying it again on the next job
      if (status === 401 || status === 403) s.coolUntil = Date.now() + this.cfg.breaker.coolSec * 1000;
      this.record(model, false, false);
      throw Object.assign(new Error(`${model} ${status}: ${errText.slice(0, 300)}`), { retry: true, client: true });
    }
    s.fails = 0;
    this.record(model, true, false);
    return { text: text.replace(/<think>[\s\S]*?<\/think>/g, '').trim(), tokens, latency, status };
  }
}

module.exports = { Router, Fatal, loadConfig, readKey, sleep };
