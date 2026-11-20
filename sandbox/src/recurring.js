'use strict';
const { parseDate, formatDate } = require('./dates');

// Next due date after `from` ('YYYY-MM-DD') for a 'weekly' or 'monthly' bill.
// Monthly bills keep their day of the month, or use the last day of a shorter month: Jan 31 -> Feb 28 (Feb 29 in a leap year).
function nextDue(from, freq) {
  const d = parseDate(from);
  if (freq === 'weekly') return formatDate(new Date(d.getTime() + 7 * 86400000));
  if (freq === 'monthly') return formatDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())));
  throw new Error(`unknown frequency: ${freq}`);
}

module.exports = { nextDue };
