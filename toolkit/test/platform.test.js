'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../platform');

test('parseGpus: nvidia-smi csv', () => {
  assert.deepStrictEqual(P.parseGpus({ nvidiaSmi: 'NVIDIA GeForce RTX 3060, 12288\n' }),
    [{ vendor: 'nvidia', name: 'NVIDIA GeForce RTX 3060', vramGB: 12, unified: false }]);
});

test('parseGpus: Windows video controllers (AMD, Intel), skips basic display and NVIDIA already seen by nvidia-smi', () => {
  const winVideo = JSON.stringify([
    { Name: 'AMD Radeon RX 6700 XT', AdapterRAM: 4293918720 },
    { Name: 'Intel(R) UHD Graphics 630', AdapterRAM: 1073741824 },
    { Name: 'Microsoft Basic Display Adapter', AdapterRAM: 0 },
    { Name: 'NVIDIA GeForce RTX 3060', AdapterRAM: 4293918720 },
  ]);
  const g = P.parseGpus({ nvidiaSmi: 'NVIDIA GeForce RTX 3060, 12288', winVideo });
  assert.deepStrictEqual(g.map((x) => x.vendor), ['nvidia', 'amd', 'intel']);
  assert.strictEqual(g[1].vramGB, 4);       // AdapterRAM is capped near 4 GB by Windows; rounded
  assert.strictEqual(g[2].vramGB, 1);
  // a single controller comes back as an object, not an array
  assert.deepStrictEqual(P.parseGpus({ winVideo: JSON.stringify({ Name: 'Intel(R) Iris(R) Xe Graphics', AdapterRAM: 2147483648 }) }),
    [{ vendor: 'intel', name: 'Intel(R) Iris(R) Xe Graphics', vramGB: 2, unified: false }]);
});

test('parseGpus: Apple Silicon is unified memory; lspci lines on Linux; junk input gives []', () => {
  const mac = JSON.stringify({ SPDisplaysDataType: [{ sppci_model: 'Apple M2 Pro', sppci_vendor: 'sppci_vendor_Apple' }] });
  assert.deepStrictEqual(P.parseGpus({ macProfiler: mac }), [{ vendor: 'apple', name: 'Apple M2 Pro', vramGB: null, unified: true }]);
  const lspci = '00:02.0 VGA compatible controller: Intel Corporation Alder Lake-P GT2 [Iris Xe Graphics]\n03:00.0 Display controller: Advanced Micro Devices, Inc. [AMD/ATI] Navi 23\n00:1f.3 Audio device: Intel Corporation';
  assert.deepStrictEqual(P.parseGpus({ lspci }).map((x) => [x.vendor, x.vramGB]), [['intel', null], ['amd', null]]);
  assert.deepStrictEqual(P.parseGpus({ nvidiaSmi: 'garbage', winVideo: 'not json', macProfiler: '{' }), []);
  assert.deepStrictEqual(P.parseGpus({}), []);
});

test('usableVramGB: biggest dedicated card, or about two thirds of RAM on Apple unified memory, else 0', () => {
  assert.strictEqual(P.usableVramGB([{ vendor: 'intel', vramGB: 1 }, { vendor: 'nvidia', vramGB: 12 }], 32), 12);
  assert.strictEqual(P.usableVramGB([{ vendor: 'apple', vramGB: null, unified: true }], 16), 10);
  assert.strictEqual(P.usableVramGB([], 16), 0);
});

test('installPlan: per platform; Linux steps that need sudo say so; unknown tool throws', () => {
  assert.deepStrictEqual(P.installPlan('ollama', 'win32'), { cmd: 'winget', args: ['install', '-e', '--id', 'Ollama.Ollama', '--accept-source-agreements', '--accept-package-agreements'], sudo: false });
  assert.deepStrictEqual(P.installPlan('node', 'win32').args.slice(0, 4), ['install', '-e', '--id', 'OpenJS.NodeJS.LTS']);
  assert.deepStrictEqual(P.installPlan('ollama', 'darwin'), { cmd: 'brew', args: ['install', 'ollama'], sudo: false });
  assert.deepStrictEqual(P.installPlan('node', 'darwin'), { cmd: 'brew', args: ['install', 'node'], sudo: false });
  assert.deepStrictEqual(P.installPlan('ollama', 'linux'), { cmd: 'sh', args: ['-c', 'curl -fsSL https://ollama.com/install.sh | sh'], sudo: true });
  assert.strictEqual(P.installPlan('node', 'linux').sudo, true);
  for (const pf of ['win32', 'darwin', 'linux']) assert.deepStrictEqual(P.installPlan('omniroute', pf), { cmd: 'npm', args: ['install', '-g', 'omniroute'], sudo: false });
  assert.throws(() => P.installPlan('nope', 'win32'));
});

test('pathFromReg: reads PATH out of `reg query` output and expands %VARS%', () => {
  const user = '\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\tools\r\n\r\n';
  const machine = '\r\nHKEY_LOCAL_MACHINE\\SYSTEM\\...\\Environment\r\n    Path    REG_SZ    C:\\Windows;C:\\Program Files\\nodejs\\\r\n';
  assert.strictEqual(P.pathFromReg(machine, user, { USERPROFILE: 'C:\\Users\\me' }), 'C:\\Windows;C:\\Program Files\\nodejs\\;C:\\Users\\me\\bin;C:\\tools');
  assert.strictEqual(P.pathFromReg('', '', {}), '');
});

test('progress: remembers finished steps across runs so a failed install resumes', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prog-')), 'progress.json');
  const a = P.progress(f);
  assert.strictEqual(a.isDone('node'), false);
  a.done('node');
  const b = P.progress(f);
  assert.strictEqual(b.isDone('node'), true);
  b.reset();
  assert.strictEqual(P.progress(f).isDone('node'), false);
});
