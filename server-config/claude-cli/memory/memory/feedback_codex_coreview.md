---
name: Codex co-review mandatory
description: Use Codex CLI as co-reviewer after every major code change or complex logic — user pays $20/mo for ChatGPT Plus
type: feedback
---

Run `/codex` after every major code change, complex logic, or before significant commits. Gil pays for ChatGPT Plus ($20/mo) and wants Codex as a second pair of eyes.

**Why:** Gil invested in the paid plan specifically for code review quality. Two-model review catches blind spots that single-model review misses.

**How to apply:**
- After writing/editing 50+ lines, complex logic, security changes, or core module refactors — run `/codex`
- Always verify Codex is on the latest model (currently gpt-5.4) with xhigh reasoning effort
- Check `~/.codex/config.toml` before each review to confirm model/effort haven't regressed
- Report model + effort level to Gil so he can verify
