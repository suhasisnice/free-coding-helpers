# ledger

A tiny personal expense tracker for the command line. Plain Node.js, no dependencies.

```
node src/cli.js add 2026-03-05 12.50 food lunch with the team
node src/cli.js list --category food
node src/cli.js report --month 2026-03
node src/cli.js import bank-export.csv
node src/cli.js budget --file budgets.json --month 2026-03
```

Data lives in `ledger.json` (override with `LEDGER_FILE`). Amounts are stored as integer cents.

## Modules

| file | what it does |
|------|--------------|
| `src/money.js` | parse user amounts into cents, format cents for display, split a bill |
| `src/dates.js` | `YYYY-MM-DD` parsing/formatting and day arithmetic, all in UTC |
| `src/csv.js` | small RFC 4180 CSV reader/writer |
| `src/validate.js` | validation rules for an expense |
| `src/store.js` | JSON-file store: load, save, add, remove, list |
| `src/report.js` | totals by category and month, top expenses, text summary |
| `src/budget.js` | monthly budgets and 80% alerts |
| `src/importer.js` | import a bank CSV, reporting bad rows by line |
| `src/text.js` | truncate, slugify, plural |
| `src/cli.js` | argument parsing and commands |

## Tests

`npm test` runs `test/**/*.test.js` with the built-in `node:test` runner.
`checks/` and `scripts/` hold per-task acceptance checks used by the fcode benchmark (`jobs.json`); they are not part of the normal suite.
