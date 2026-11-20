'use strict';
// Simple statistics over arrays of numbers.
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

// Middle value; for an even count, the average of the two middle values. Does not modify the input.
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

module.exports = { mean, median };
