'use strict';
const { formatCents } = require('./money');

function totalsByCategory(expenses) {
  const totals = {};
  for (const e of expenses) totals[e.category] = (totals[e.category] || 0) + e.amount;
  return totals;
}

// Keys are 'YYYY-MM'.
function totalsByMonth(expenses) {
  const totals = {};
  for (const e of expenses) {
    const d = new Date(e.date + 'T00:00:00Z');
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    totals[key] = (totals[key] || 0) + e.amount;
  }
  return totals;
}

// Largest expenses first; ties broken by earlier date. Does not modify the input.
function topN(expenses, n = 5) {
  return [...expenses]
    .sort((a, b) => b.amount - a.amount || a.date.localeCompare(b.date))
    .slice(0, n);
}

function pad(s, width) {
  s = String(s);
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

// One line per category (alphabetical), then a TOTAL line.
function summarize(expenses) {
  const totals = totalsByCategory(expenses);
  const lines = Object.keys(totals).sort().map((c) => pad(c, 12) + formatCents(totals[c]));
  const all = expenses.reduce((sum, e) => sum + e.amount, 0);
  lines.push(pad('TOTAL', 12) + formatCents(all));
  return lines.join('\n');
}

module.exports = { totalsByCategory, totalsByMonth, topN, summarize };
