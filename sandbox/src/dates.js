'use strict';
// Dates are 'YYYY-MM-DD' strings at the edges and UTC Date objects inside, so time zones never shift a day.

const DAY_MS = 86400000;

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`invalid date: ${s}`);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // Date.UTC silently rolls 2026-02-30 over to March; reject that instead.
  if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw new Error(`invalid date: ${s}`);
  return d;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  return new Date(d.getTime() + n * DAY_MS);
}

// Whole days from a to b (negative if b is earlier).
function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

// month is 1-12
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isWeekend(d) {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

module.exports = { parseDate, formatDate, addDays, daysBetween, daysInMonth, isWeekend };
