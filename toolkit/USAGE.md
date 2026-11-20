# fcode — one page

Free-model code changes through OmniRoute (`http://localhost:20128`). Node 18+, no installs.
It never touches your files unless the check passes.

## Before you start

1. `omniroute` running in its own terminal.
2. `OMNIROUTE_KEY` set (`setx OMNIROUTE_KEY ...` once, then open a NEW terminal). fcode also reads it from the
   Windows registry if the terminal is older. It never prints it.

## Commands

```bash
node toolkit/fcode.js edit     "Raise the max description length to 140" --files src/validate.js --check "npm test"
node toolkit/fcode.js bugfix   "parseAmount('12.5') returns 1205, should be 1250" --files src/money.js --check "npm test"
node toolkit/fcode.js tests    "Write test/text.test.js covering truncate/slugify/plural" --files src/text.js,test/text.test.js --check "node --test test/text.test.js"
node toolkit/fcode.js refactor "Rename parseAmount to toCents everywhere" --files src/money.js,src/cli.js,src/importer.js --check "npm test"
node toolkit/fcode.js feature  "Add averageByCategory(expenses) to report.js" --files src/report.js --check "npm test"
node toolkit/fcode.js explain  "What does importCSV do with a bad row?" --files src/importer.js
node toolkit/fcode.js review   "Find correctness bugs" --files src/store.js
```

- `--files` is everything the model sees. Name every file it must change **and** the ones it needs to read.
  A file that doesn't exist yet is created (e.g. a new test file).
- `--check` is any shell command; exit code 0 = accept. Without it fcode only syntax-checks the changed files — pass a real check.
- Run it from the project root (or pass `--root dir`).

## What happens

1. A prompt is built from only the named files, in the edit format that model does best (full file / search-replace / diff).
2. The reply is applied to a scratch copy in your temp folder and the check runs there.
3. Check fails → the error goes back to the same model once. Still failing → next model, on a different provider.
4. Up to 3 models, up to 5 transient errors. 429s and 5xx fail over automatically (cooled / circuit-broken models are skipped).
   Replies are streamed: that avoids the gateway's ~32 s 504, and a stream that stops before `finish_reason` counts as an error,
   never as an answer. A "tokens per day" 429 (Groq gpt-oss-20b: 200,000/day) cools that model for at least 10 min.
5. On pass, only the named files are copied back. Last line says which model answered:
   `✔ applied by mistral/codestral-latest (attempts 1, calls 1, 3s)` or `✘ not verified … working tree untouched`.

## Tuning

Edit `toolkit/router.config.json`: per-type model `chains` (first = tried first), per-model `rpm` (buckets run at
`safety` × rpm), `format`, `class`. Or one-off: `--patch '{"maxAttempts":5}'`.
Models on the `never` / `gated` lists are refused even if you put them in a chain.

## When it says STOPPED

A model returned 402 / "paid" / "quota", or too many calls errored. Nothing was written. Check the provider's
quota page before running again. Note that every Gemini 429 contains "quota", so hitting Gemini's free-tier limit stops the run by design;
drop Gemini from the chain with `--patch` for the rest of the day.

## Added 2026-09-30
- `--probe "<cmd>"`: runs the command in the project root and puts its output in the prompt as "observed values". Use it for `tests` jobs: a throwaway script that prints the real return values. Real-repo test job went from fail to pass (11 tests, 2 calls, groq gpt-oss-120b).
- `tests` chain now starts with groq gpt-oss-120b. gemma4:31b and ollamacloud nemotron-3-super removed from every chain (high error rates).
- Deny-list: `fcode` refuses protected/sensitive files; add regexes, one per line, to `<root>/.fcode-deny`.

## Local Ollama and sensitive work (added 2026-10-23)

- `local/qwen2.5-coder:7b` is the last model in every chain. It is tried when the cloud models fail to answer (even past the retry limit), never when they answer wrongly (that stops at 3 attempts).
- **Sensitive jobs:** add `--local-only` (or `FCODE_LOCAL_ONLY=1`), or list the file's path as a regex in `<root>/.fcode-local`. The job then uses a router that has no cloud key and refuses every non-local model. If Ollama is down the job fails; it never falls back to the cloud. This is explicit, not auto-detection: a data file nobody listed is not recognised.
- `--local-only` also skips the `.fcode-deny` / built-in deny-list (nothing leaves the PC).
- Own task list on a real repo (runs on a copy, your tree is untouched): `node toolkit/fcode.js bench --spec toolkit/sih-bench.json --root <repo> --name sih-1` (start from `sih-bench.example.json`).
- Tests (no network, no quota): `node --test toolkit/test/router.test.js`

## Handover (2026-10-23)

**Verified**
- Router tests: `node --test test/router.test.js` (18 pass).
- SIH benchmark on disposable copies (frontend `src/lib` + `src/api` only; backend not validated here): round 1 5/5, round 2 4/4 (synthetic data, real repo untouched).
- Cloud to local fallback: dead gateway (`--patch '{"gateway":"http://localhost:1/v1"}'`) -> 6 cloud neterr -> `local/qwen2.5-coder:7b` verified.
- Gemini 429 no longer stops the run (benches the model, honors Retry-After; PerDay = 1h+ cooldown).

**Known limits**
- Gemini flash-lite sometimes replies HTTP 200 without the edit format ("no edit found in the reply"); seen twice on R3, codestral then passed. One task only, so no chain change; parser left strict on purpose.
- Cooldown state is per process (not kept between CLI runs).
- Failed network attempts still count toward `callCap` (1500; ~1255 used).
- Not covered: UI, backend, end-to-end.

**Commands**
- Run a job: `node fcode.js <type> "<task>" --root <proj> --files a,b --check "<cmd>"`
- Benchmark on a copy: `node fcode.js bench --spec sih-bench2.json --root <copy> --name <run> [--jobs R3-timeout]`
- Sensitive work: add `--local-only`. Apply-error reasons are in the run log (`why` field).

## Setup wizard (2026-10-23)
`node setup-wizard.js --agent claude|antigravity [--dest <dir>] [--project <dir>] [--dry-run] [--uninstall]`
- Detects RAM/GPU/disk/tools, asks which plan (Claude Pro or not), picks local models by specs, installs after you confirm each step.
- `--project` creates starter `.fcode-deny` / `.fcode-local` if missing. `--sim high|mid|low|tiny` fakes a PC for testing. Tests: `node --test test/wizard.test.js`.
- Result is in `<dest>/.fcode-install.json` (no secrets). Exit 1 + INCOMPLETE if any step failed. Rerun is safe; `--uninstall` restores backups.
- Limits: Antigravity reading the rules file is unverified; only NVIDIA GPUs detected; no proxy/offline handling; cloud-only PCs are not safe for sensitive data.
- Pilot first on one Antigravity teammate, then roll out.
