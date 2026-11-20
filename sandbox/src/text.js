'use strict';

// Shorten s to at most max characters, marking the cut with "...".
function truncate(s, max) {
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}

// "Café & Bar!" -> "cafe-bar"
function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// plural(1, 'expense') -> "1 expense", plural(0, 'expense') -> "0 expenses"
function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

module.exports = { truncate, slugify, plural };
