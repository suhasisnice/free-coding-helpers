# Delegation toolkit

The Delegation toolkit helps you save tokens by offloading small coding jobs to free AI models. Claude writes the instructions and reviews the results.

## What this is

It hands small, checkable coding jobs from Claude Code (or Antigravity) to free AI models, so Claude spends fewer tokens.

## Install

- **Windows:** double-click `setup.bat`.
- **macOS or Linux:** open a terminal in this folder and run:

  ```sh
  sh install.sh
  ```
- **Terminal only (any system):** `node setup-wizard.js`

It checks your memory and graphics card (NVIDIA, AMD, Intel or Apple Silicon), asks before installing Node, OmniRoute and Ollama, picks a local model that fits, and copies the toolkit to a folder called fcode-toolkit in your home folder. On Linux, steps that need sudo are printed for you to run yourself. Running it again skips what already worked.

## Add free provider keys

The setup lists free providers (Groq, Google Gemini, NVIDIA, OpenRouter, Cerebras, Cloudflare, Cohere, SambaNova, Hugging Face). The Get key button opens that provider's key page. You sign in, create a key, copy it, paste it into the setup. It is checked with a free test call that uses no tokens, then saved inside OmniRoute. Never paste a key into a chat.

## Use it

From your project folder, Claude (or you) runs:

```sh
node ~/fcode-toolkit/fcode.js bugfix "what to fix" --root . --files src/a.js --check "npm test"
```

The check command is how the toolkit knows the change is right: it must fail before the fix and pass after. Job types: edit, bugfix, tests, refactor, feature, explain, review. Add `--local-only` for private code or data so nothing leaves the PC.

## What we measured

Measured on 2026-11-20 with a 57-task exam: Groq gpt-oss-120b passed 54/57 and was fastest (about 2 seconds per call); NVIDIA nemotron-3-ultra passed 53/57 but was slow (about 14 seconds); Google gemini-flash-lite passed 49/57. Mistral Codestral now asks for a paid subscription, so it is not used. The full table is in results-full.md.

## Limits and cooldowns

Each provider allows only so many requests and tokens per minute and per day. The router keeps each model under 80% of its published limits, remembers what it used across runs (folder limits-state), skips a request that is bigger than a model's whole per-minute allowance (Groq allows 8,000 tokens per minute), and when a provider says slow down it waits exactly as long as the provider asks, then tries another model.

## Savings

`node savings.js` writes `savings.html`, a page showing jobs, passes, failures and Claude tokens and dollars saved per provider. `node rules.js <run-name> --write` reorders which model is tried first for each job type from benchmark results; fcode prints a note when a job type usually fails.

## Safety

- It never commits or pushes.
- A `.fcode-deny` file in a project blocks matching files from being sent.
- A `.fcode-local` file forces local-only for matching files.
- Paid models are refused, and a payment-required answer stops the run.

## Uninstall

`node setup-wizard.js --uninstall` removes the toolkit folder and the rules it added. Programs and downloaded models stay.

## Make a release zip for someone else

`node pack.js` runs all tests first, then writes `dist/free-coding-helpers.zip`.
