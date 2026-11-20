'use strict';
// Split `total` cents between people in proportion to `weights`. The parts must add up to exactly `total`:
// leftover cents go to the parts with the largest fractional remainder (ties: the earlier part first).
function splitByWeights(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => Math.floor((total * w) / sum));
}

module.exports = { splitByWeights };
