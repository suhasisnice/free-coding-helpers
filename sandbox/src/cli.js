#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { parseAmount, formatCents } = require('./money');
const { validateExpense } = require('./validate');
const { importCSV } = require('./importer');
const { summarize } = require('./report');
const { checkBudgets } = require('./budget');

// ['list', '--category', 'food'] -> { command: 'list', args: [], flags: { category: 'food' } }
// A flag followed by another flag (or nothing) is a boolean: ['list', '--all'] -> flags.all === true
function parseArgs(argv) {
  const out = { command: argv[0], args: [], flags: {} };
  for (let i = 1; i < argv.length - 1; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out.flags[a.slice(2)] = true;
      else { out.flags[a.slice(2)] = next; i++; }
    } else out.args.push(a);
  }
  return out;
}

function pad(s, width) {
  s = String(s);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

// Returns an exit code. `out` receives one line of output per call.
function run(argv, { store, out = console.log }) {
  const { command, args, flags } = parseArgs(argv);
  switch (command) {
    case 'add': {
      const [date, amount, category, ...words] = args;
      const e = { date, amount: parseAmount(amount), category, description: words.join(' ') };
      const v = validateExpense(e);
      if (!v.ok) { out('error: ' + v.errors.join('; ')); return 1; }
      const item = store.add(e);
      store.save();
      out(`added #${item.id} ${formatCents(item.amount)} ${item.category}`);
      return 0;
    }
    case 'list': {
      for (const e of store.list({ category: flags.category, month: flags.month })) {
        out(`${pad('#' + e.id, 5)}${e.date}  ${pad(formatCents(e.amount), 11)}${pad(e.category, 11)}${e.description}`);
      }
      return 0;
    }
    case 'report':
      out(summarize(store.list({ month: flags.month })));
      return 0;
    case 'import': {
      const { expenses, errors } = importCSV(fs.readFileSync(args[0], 'utf8'));
      for (const e of expenses) store.add(e);
      store.save();
      for (const err of errors) out(err);
      out(`imported ${expenses.length}, rejected ${errors.length}`);
      return errors.length ? 1 : 0;
    }
    case 'budget': {
      const budgets = JSON.parse(fs.readFileSync(flags.file || 'budgets.json', 'utf8'));
      for (const r of checkBudgets(store.list(), budgets, flags.month || currentMonth())) {
        const mark = r.over ? ' OVER' : r.alert ? ' !' : '';
        out(`${pad(r.category, 12)}${pad(formatCents(r.spent), 12)}${r.pct}%${mark}`);
      }
      return 0;
    }
    default:
      out('usage: ledger <add|list|report|import|budget> [args] [--flags]');
      return 2;
  }
}

if (require.main === module) {
  const { createStore } = require('./store');
  const store = createStore(process.env.LEDGER_FILE || 'ledger.json');
  store.load();
  process.exitCode = run(process.argv.slice(2), { store });
}

module.exports = { parseArgs, run };
