'use strict';
// " Food, fun ,,FOOD " -> ['food', 'fun']: trimmed, lower-case, no empty tags, no duplicates, first-seen order.
function parseTags(input) {
  const seen = new Set();
  return String(input).split(',').map((t) => t.trim().toLowerCase()).filter((t) => !seen.has(t) && seen.add(t));
}

module.exports = { parseTags };
