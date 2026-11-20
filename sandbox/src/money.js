'use strict';
// Money is stored as integer cents everywhere. Strings only exist at the edges (input and display).

const SYMBOLS = { USD: '$' };

// Parse a user-entered amount like "12", "12.50", "1,234.5" or "$8" into integer cents.
function parseAmount(input) {
  const s = String(input).trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) throw new Error(`invalid amount: ${input}`);
  const negative = s.startsWith('-');
  const [whole, frac = ''] = s.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac || 0);
  return negative ? -cents : cents;
}

// 123456 -> "$1,234.56", -500 -> "-$5.00"
function formatCents(cents, currency = 'USD') {
  const symbol = SYMBOLS[currency];
  if (!symbol) throw new Error(`unsupported currency: ${currency}`);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${symbol}${whole}.${frac}`;
}

// Split a total into `parts` integer amounts that add up exactly to the total.
// Leftover cents go to the earliest parts: splitEvenly(1000, 3) -> [334, 333, 333].
function splitEvenly(total, parts) {
  if (!Number.isInteger(parts) || parts < 1) throw new Error('parts must be a positive integer');
  const base = Math.floor(total / parts);
  const rem = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rem ? 1 : 0));
}

module.exports = { parseAmount, formatCents, splitEvenly };
