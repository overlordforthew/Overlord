---
name: llm-cli-tools
description: llm CLI at /usr/local/bin/llm — Gemini plugin working, OpenRouter plugin installed but key dead.
type: reference
---

`llm` CLI is installed at `/usr/local/bin/llm` with two plugins:
- **llm-openrouter** (v0.5) — installed but key returns 401 (see openrouter-key-dead.md)
- **llm-gemini** (v0.30) — installed 2026-04-06, working. Key set from Google API key.

**Working models:**
- `gemini/gemini-2.5-flash` — fast, free tier, good for extraction tasks
- `gemini/gemini-2.5-flash-lite` — lighter variant
- `gemini/gemini-2.5-pro` — more capable
- All OpenAI models (GPT-4.1, GPT-5, o3, o4-mini, etc.) — via OpenAI key

**Used by:** /research skill's gemini engine (`research-lane.sh`), /crossreview skill

**How to apply:** Use `llm -m 'gemini/gemini-2.5-flash'` for free LLM calls outside Claude Code's Agent tool. Useful for batch processing, extraction, and analysis where Claude API cost matters.
