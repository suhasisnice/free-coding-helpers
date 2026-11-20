'use strict';

const CATEGORIES = ['food', 'rent', 'transport', 'utilities', 'fun', 'other'];
const ALERT_RATIO = 0.8; // warn once 80% of a budget is spent

// budgets: { food: 30000, ... } monthly limits in cents. month: 'YYYY-MM'.
// Returns one row per known budgeted category: { category, spent, limit, pct, over, alert }.
function checkBudgets(expenses, budgets, month) {
  return Object.keys(budgets)
    .filter((c) => CATEGORIES.includes(c.toLowerCase()))
    .map((category) => {
      const spent = expenses
        .filter((e) => e.date.startsWith(month) && e.category === category)
        .reduce((sum, e) => sum + e.amount, 0);
      const limit = budgets[category];
      return {
        category,
        spent,
        limit,
        pct: Math.round((spent / limit) * 100),
        over: spent > limit,
        alert: spent >= limit * ALERT_RATIO,
      };
    });
}

module.exports = { checkBudgets, ALERT_RATIO };
