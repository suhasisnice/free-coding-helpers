'use strict';
// Platform helpers for the setup wizard: GPU scan beyond NVIDIA, install commands per OS,
// PATH refresh on Windows without a restart, and resume-after-failure progress.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
const vendorOf = (s) => (/nvidia/i.test(s) ? 'nvidia' : /amd|radeon|\bati\b|advanced micro devices/i.test(s) ? 'amd' : /intel/i.test(s) ? 'intel' : /apple/i.test(s) ? 'apple' : 'other');

function parseGpus({ nvidiaSmi, winVideo, macProfiler, lspci } = {}) {
  const out = [];
  for (const line of String(nvidiaSmi || '').split(/\r?\n/)) {
    const m = /^(.+?),\s*(\d+)\s*$/.exec(line.trim());
    if (m) out.push({ vendor: 'nvidia', name: m[1].trim(), vramGB: Math.round(+m[2] / 1024), unified: false });
  }
  const sawNvidia = out.length > 0;
  let win = parse(winVideo);
  if (win && !Array.isArray(win)) win = [win];
  for (const c of win || []) {
    if (!c || !c.Name || /microsoft basic display/i.test(c.Name)) continue;
    const vendor = vendorOf(c.Name);
    if (vendor === 'nvidia' && sawNvidia) continue;
    out.push({ vendor, name: c.Name, vramGB: c.AdapterRAM ? Math.round(c.AdapterRAM / 2 ** 30) : null, unified: false });
  }
  const mac = parse(macProfiler);
  for (const d of (mac && mac.SPDisplaysDataType) || []) {
    const name = d.sppci_model || '';
    if (!name) continue;
    const apple = /apple/i.test(name);
    out.push({ vendor: apple ? 'apple' : vendorOf(name), name, vramGB: apple ? null : parseInt(d.spdisplays_vram, 10) || null, unified: apple });
  }
  for (const line of String(lspci || '').split(/\r?\n/)) {
    const m = /(VGA compatible controller|3D controller|Display controller): (.*)$/.exec(line);
    if (m) out.push({ vendor: vendorOf(m[2]), name: m[2].trim(), vramGB: null, unified: false });
  }
  return out;
}

// ponytail: Apple unified memory -> two thirds of RAM is a rule of thumb; tune if models fail to load
function usableVramGB(gpus, ramGB) {
  const dedicated = gpus.filter((g) => !g.unified && g.vramGB).map((g) => g.vramGB);
  if (dedicated.length) return Math.max(...dedicated);
  return gpus.some((g) => g.unified) ? Math.floor((ramGB * 2) / 3) : 0;
}

// Runs the platform's own GPU tools; each one that is missing simply gives nothing.
function scanGpus() {
  const run = (c) => { try { return cp.execSync(c, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 }); } catch { return ''; } };
  const o = { nvidiaSmi: run('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits') };
  if (process.platform === 'win32') o.winVideo = run('powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json"');
  if (process.platform === 'darwin') o.macProfiler = run('system_profiler SPDisplaysDataType -json');
  if (process.platform === 'linux') o.lspci = run('lspci');
  return parseGpus(o);
}

const WINGET = ['--accept-source-agreements', '--accept-package-agreements'];
const PLANS = {
  node: {
    win32: { cmd: 'winget', args: ['install', '-e', '--id', 'OpenJS.NodeJS.LTS', ...WINGET], sudo: false },
    darwin: { cmd: 'brew', args: ['install', 'node'], sudo: false },
    linux: { cmd: 'sh', args: ['-c', 'curl -fsSL https://deb.nodesource.com/setup_lts.x | bash - && apt-get install -y nodejs'], sudo: true },
  },
  ollama: {
    win32: { cmd: 'winget', args: ['install', '-e', '--id', 'Ollama.Ollama', ...WINGET], sudo: false },
    darwin: { cmd: 'brew', args: ['install', 'ollama'], sudo: false },
    linux: { cmd: 'sh', args: ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], sudo: true },
  },
};
function installPlan(tool, platform = process.platform) {
  if (tool === 'omniroute' && PLANS.node[platform]) return { cmd: 'npm', args: ['install', '-g', 'omniroute'], sudo: false };
  const p = PLANS[tool] && PLANS[tool][platform];
  if (!p) throw new Error(`no install plan for ${tool} on ${platform}`);
  return { cmd: p.cmd, args: [...p.args], sudo: p.sudo };
}

function pathFromReg(machineText, userText, env = process.env) {
  const one = (t) => {
    const m = /^\s*path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(String(t || ''));
    return m ? m[1].trim().replace(/%([^%]+)%/g, (all, k) => (env[k] != null ? env[k] : all)) : '';
  };
  return [one(machineText), one(userText)].filter(Boolean).join(';');
}

// Windows: pick up PATH changes from an install that just ran, without opening a new terminal.
function refreshPath() {
  if (process.platform !== 'win32') return process.env.PATH;
  const q = (k) => { try { return cp.execSync(`reg query "${k}" /v Path`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { return ''; } };
  const p = pathFromReg(q('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'), q('HKCU\\Environment'));
  if (p) process.env.PATH = process.env.Path = p;
  return p;
}

function progress(file) {
  const read = () => { const a = parse(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '[]'); return Array.isArray(a) ? a : []; };
  const write = (a) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(a)); };
  return {
    isDone: (step) => read().includes(step),
    done: (step) => { const a = read(); if (!a.includes(step)) { a.push(step); write(a); } },
    reset: () => write([]),
  };
}

module.exports = { parseGpus, usableVramGB, scanGpus, installPlan, pathFromReg, refreshPath, progress };
