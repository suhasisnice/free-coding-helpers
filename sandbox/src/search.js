'use strict';
// Expenses whose description contains the query, ignoring upper/lower case and any spaces around the query.
// An empty query matches nothing.
function searchExpenses(items, query) {
  const q = String(query).trim();
  if (!q) return [];
  return items.filter((e) => e.description.includes(q));
}

module.exports = { searchExpenses };
