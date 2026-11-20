'use strict';
// Grades a "write tests" job: the new test file must pass on the real module
// and fail on every mutant below (a test that asserts nothing kills no mutants).
// Usage: node scripts/check-tests.js T1
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const JOBS = {
  T1: { test: 'test/dates.test.js', module: 'src/dates.js', mutants: [
    ['if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3])', 'if (false)'],
    ['Date.UTC(year, month, 0)', 'Date.UTC(year, month - 1, 0)'],
    ['day === 0 || day === 6', 'day === 0 || day === 5'],
  ] },
  T2: { test: 'test/text.test.js', module: 'src/text.js', mutants: [
    ["s.slice(0, max - 3) + '...'", "s.slice(0, max) + '...'"],
    [".replace(/^-+|-+$/g, '')", ".replace(/^-+/g, '')"],
    ["n === 1 ? '' : 's'", "n <= 1 ? '' : 's'"],
  ] },
  T3: { test: 'test/validate.test.js', module: 'src/validate.js', mutants: [
    [' || e.amount <= 0', ''],
    ['!CATEGORIES.includes(e.category)', 'false'],
    ["!/^\\d{4}-\\d{2}-\\d{2}$/.test(e.date || '')", 'false'],
  ] },
  T4: { test: 'test/csv-write.test.js', module: 'src/csv.js', mutants: [
    ['/[",\\n\\r]/', '/["\\n\\r]/'],
    ['s.replace(/"/g, \'""\')', 's'],
    ["value == null ? '' :", "value == null ? 'null' :"],
  ] },
  T5: { test: 'test/split.test.js', module: 'src/money.js', mutants: [
    ['base + (i < rem ? 1 : 0)', 'base'],
    ['parts < 1', 'parts < 0'],
    ['(i < rem ? 1 : 0)', '(i >= parts - rem ? 1 : 0)'],
  ] },
  T6: { test: 'test/topn.test.js', module: 'src/report.js', mutants: [
    ['b.amount - a.amount', 'a.amount - b.amount'],
    ['.slice(0, n)', '.slice(0)'],
    [' || a.date.localeCompare(b.date)', ''],
  ] },
  L5: { test: 'test/merchants.test.js', module: 'src/merchants.js', mutants: [
    ['.toLowerCase()', ''],
    ['text.includes(key)', 'text.startsWith(key)'],
    ["return 'other';", "return 'fun';"],
  ] },
};

const job = JOBS[process.argv[2]];
if (!job) { console.error('unknown job ' + process.argv[2]); process.exit(2); }
const root = path.join(__dirname, '..');
const testFile = path.join(root, job.test);
const modFile = path.join(root, job.module);
const runTests = () => spawnSync(process.execPath, ['--test', testFile], { cwd: root, encoding: 'utf8' });

if (!fs.existsSync(testFile)) { console.error('missing ' + job.test); process.exit(1); }
const clean = runTests();
if (clean.status !== 0) {
  console.error(job.test + ' fails on the real module:\n' + (clean.stdout + clean.stderr).slice(-3000));
  process.exit(1);
}
const original = fs.readFileSync(modFile, 'utf8');
const survivors = [];
try {
  for (const [from, to] of job.mutants) {
    if (!original.includes(from)) { console.error(job.module + ' was changed; tests jobs must not edit the module'); process.exit(1); }
    fs.writeFileSync(modFile, original.replace(from, to));
    if (runTests().status === 0) survivors.push(from + '  ->  ' + to);
  }
} finally {
  fs.writeFileSync(modFile, original);
}
if (survivors.length) {
  console.error(`tests pass but miss ${survivors.length}/${job.mutants.length} deliberate bugs in ${job.module}:\n` + survivors.join('\n'));
  process.exit(1);
}
console.log(`ok: ${job.test} passes and catches ${job.mutants.length}/${job.mutants.length} mutants`);
