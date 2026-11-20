'use strict';
// Grades an explain/review answer. fcode writes the model's answer to the file in
// $FCODE_ANSWER; every required fact below must appear in it.
// Usage: node scripts/check-answer.js X1
const fs = require('fs');

const FACTS = {
  // importer: invalid rows are skipped and reported with their line number
  X1: [/\b(skip|skipped|skips|omit|ignored|dropped|excluded|not (added|included|imported))/i, /errors?\b/i, /line/i],
  // store: ids come from items.length + 1 (duplicates after a delete) and splice(i) removes the tail
  X2: [/(duplicate|same id|reuse|re-use|collid|clash|not unique|unique)/i, /splice/i],
  // budget: alert at 80% of the limit, over only when spent exceeds the limit
  X3: [/80\s*%|0\.8\b/, /(exceed|greater than|more than|above|>\s*limit|spent\s*>)/i],
  // merchants: first matching rule in table order wins (substring, lowercased); no match returns 'other'
  // dates.parseDate: Date.UTC rolls impossible dates over, so the code compares month/day and throws
  X4: [/(roll|overflow|wrap|spill|march|next month|following month)/i, /(invalid|reject|throw|error|not exist|doesn't exist|nonexistent)/i],
  // money.splitEvenly: base = floor(total/parts), leftover cents one each to the earliest parts, sum equals total
  X5: [/(remainder|leftover|left over|extra|spare)/i, /(first|earliest|start|front)/i, /(add up|sum|equal|total)/i],
  L3: [/(first|top|order|earlier|before)/i, /(substring|includes|contains|appears|inside)/i, /other/i],
};

const facts = FACTS[process.argv[2]];
if (!facts) { console.error('unknown job ' + process.argv[2]); process.exit(2); }
const file = process.env.FCODE_ANSWER;
if (!file || !fs.existsSync(file)) { console.error('no answer: FCODE_ANSWER is not set or missing'); process.exit(1); }
const answer = fs.readFileSync(file, 'utf8');
const missing = facts.filter((re) => !re.test(answer));
if (missing.length) {
  console.error('answer is missing required facts: ' + missing.map(String).join(', '));
  process.exit(1);
}
console.log('ok: all ' + facts.length + ' required facts present');
