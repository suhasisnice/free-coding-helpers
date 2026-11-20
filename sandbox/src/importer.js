'use strict';
const { parseCSV } = require('./csv');
const { parseAmount } = require('./money');
const { validateExpense } = require('./validate');

const HEADER = 'date,amount,category,description';

// Import a bank-style CSV export. Valid rows become expenses; invalid rows are skipped
// and reported in `errors` as "line N: reason" (N is the line number in the file).
function importCSV(text) {
  const rows = parseCSV(text);
  const header = (rows[0] || []).map((h) => h.trim().toLowerCase()).join(',');
  if (header !== HEADER) return { expenses: [], errors: [`line 1: expected header ${HEADER}`] };

  const expenses = [];
  const errors = [];
  rows.slice(1).forEach((r, i) => {
    if (r.every((f) => f.trim() === '')) return; // blank line
    const line = i + 1;
    let amount;
    try {
      amount = parseAmount(r[1]);
    } catch (err) {
      errors.push(`line ${line}: ${err.message}`);
      return;
    }
    const e = {
      date: (r[0] || '').trim(),
      amount,
      category: (r[2] || '').trim().toLowerCase(),
      description: (r[3] || '').trim(),
    };
    const v = validateExpense(e);
    if (!v.ok) {
      errors.push(`line ${line}: ${v.errors.join('; ')}`);
      return;
    }
    expenses.push(e);
  });
  return { expenses, errors };
}

module.exports = { importCSV };
