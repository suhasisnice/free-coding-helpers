'use strict';

const CATEGORIES = ['food', 'rent', 'transport', 'utilities', 'fun', 'other'];
const MAX_DESCRIPTION = 100;

// Returns { ok, errors } for an expense { date, amount (cents), category, description }.
function validateExpense(e) {
  if (!e || typeof e !== 'object') return { ok: false, errors: ['expense must be an object'] };
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) errors.push('date must be YYYY-MM-DD');
  if (!Number.isInteger(e.amount) || e.amount <= 0) errors.push('amount must be a positive number of cents');
  if (!CATEGORIES.includes(e.category)) errors.push(`unknown category: ${e.category}`);
  if (typeof e.description !== 'string' || e.description.length > MAX_DESCRIPTION) {
    errors.push(`description must be text up to ${MAX_DESCRIPTION} characters`);
  }
  return { ok: errors.length === 0, errors };
}

module.exports = { validateExpense, CATEGORIES };
