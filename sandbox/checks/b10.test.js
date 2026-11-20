'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { nextId } = require('../src/ids');
test('nextId uses highest id', () => {
  assert.strictEqual(nextId([{ id: 1 }, { id: 3 }]), 4);
  assert.strictEqual(nextId([{ id: 5 }]), 6);
  assert.strictEqual(nextId([]), 1);
  assert.strictEqual(nextId([{ id: 2 }, { id: 1 }]), 3);
});
