# Claude Code on free models (via OmniRoute)

Everything here comes from the Claude Code env-var reference (code.claude.com/docs/en/env-vars, fetched 2026-09-29)
or from OmniRoute's own `launch` command source (`bin/cli/commands/launch.mjs`, v3.8.50).
The gateway answers `GET /v1/messages` with 405 (the route exists, POST only) and an unknown path with 404.
**Untested end to end:** nobody has run a full Claude Code session through the gateway yet (it would burn many calls).

> **Out of date (November 2026):** Mistral Codestral now answers "payment required", so the `mistral/*` models below no longer work for free.
> Groq is also a poor fit here: it rejects any single request over 8,000 tokens per minute, and Claude Code's prompts are bigger than that.
> Pick a model from the benchmark in the main README that has no small per-minute token cap, and treat this page as a starting point.

## PowerShell (current window only — nothing is written to disk)

```powershell
$env:ANTHROPIC_BASE_URL   = "http://localhost:20128"        # root URL, NO /v1 — Claude Code appends /v1/messages itself
$env:ANTHROPIC_AUTH_TOKEN = $env:OMNIROUTE_KEY              # sent as "Authorization: Bearer ..."; never paste the key itself
Remove-Item Env:ANTHROPIC_API_KEY -ErrorAction SilentlyContinue   # would shadow the token (OmniRoute's launcher strips it too)
$env:ANTHROPIC_MODEL                 = "mistral/codestral-latest"      # main model
$env:ANTHROPIC_DEFAULT_SONNET_MODEL  = "mistral/codestral-latest"      # what the `sonnet` alias resolves to
$env:ANTHROPIC_DEFAULT_OPUS_MODEL    = "groq/openai/gpt-oss-120b"      # what `opus` (and opusplan in Plan Mode) resolves to
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL   = "mistral/ministral-8b-latest"   # `haiku` alias + background tasks
$env:CLAUDE_CODE_SUBAGENT_MODEL      = "mistral/codestral-latest"      # subagents
$env:MAX_THINKING_TOKENS             = "0"   # thinking OFF; on third-party providers 0 omits the thinking parameter
$env:CLAUDE_CODE_DISABLE_THINKING    = "1"   # same effect: omit the thinking parameter (for gateways that reject it)
$env:API_TIMEOUT_MS                  = "120000"
$env:CLAUDE_CODE_MAX_OUTPUT_TOKENS   = "4096"
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = "1"
claude
```

If `OMNIROUTE_KEY` is missing in this window (it was opened before `setx`), open a new terminal.

## Thinking

- Non-Gemini models (Mistral, Groq, Ollama Cloud): keep `MAX_THINKING_TOKENS=0` and `CLAUDE_CODE_DISABLE_THINKING=1`.
- Gemini models: drop both lines to let the gateway pass thinking through. unclear: whether OmniRoute maps
  Anthropic `thinking` to Gemini's thinking budget — not verified.

## Model choice

Use the per-type winners from REPORT.md (section b). Rate ceilings matter more in Claude Code than in fcode:
one Claude Code turn makes many calls, so pick a model with a high ceiling (codestral ~54/min, gpt-oss:20b ~59/min)
for `ANTHROPIC_MODEL`. Gemini Pro and the low-ceiling Gemini flash models will 429 within a few turns.

## Shortcut

OmniRoute ships `omniroute run claude --model <provider/model>` (README) which sets `ANTHROPIC_BASE_URL`,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_MODEL`, `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` and
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=190000` for you (from `launch.mjs`). It does not set the thinking variables — add them first.

## Not in the docs → unclear

- unclear: a documented way to make Claude Code fail over between models on 429 through a non-Anthropic gateway.
  `--fallback-model` exists in `claude --help`, but whether it triggers on a gateway 429 is not verified.
