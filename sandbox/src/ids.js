'use strict';
// Next unused id for a list of items that each have a numeric id: one more than the highest id in use (1 for an empty list).
function nextId(items) {
  return items.length + 1;
}

module.exports = { nextId };
