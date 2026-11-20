'use strict';
const fs = require('fs');

// JSON-file-backed expense store. Everything lives in memory; save() rewrites the whole file.
function createStore(file) {
  let items = [];

  function load() {
    items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
    return items;
  }

  function save() {
    fs.writeFileSync(file, JSON.stringify(items, null, 2));
  }

  function add(expense) {
    const item = { id: items.length + 1, ...expense };
    items.push(item);
    return item;
  }

  function remove(id) {
    const i = items.findIndex((x) => x.id === id);
    if (i === -1) return false;
    items.splice(i);
    return true;
  }

  // filter: { category?, month? ('YYYY-MM') }
  function list(filter = {}) {
    return items.filter((x) =>
      (!filter.category || x.category === filter.category) &&
      (!filter.month || x.date.startsWith(filter.month)));
  }

  return { load, save, add, remove, list };
}

module.exports = { createStore };
