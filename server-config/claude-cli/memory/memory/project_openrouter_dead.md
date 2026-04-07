---
name: openrouter-key-dead
description: OpenRouter API key returns 401 "User not found" as of 2026-04-06. Blocks free model access via llm CLI.
type: project
---

OpenRouter API key (`sk-or-v1-efc8...`) stored in overlord .env returns HTTP 401 "User not found" as of 2026-04-06.

**Impact:**
- `llm -m 'openrouter/...'` commands all fail
- Overlord memory-curator Opus extraction fails (same 401)
- 25 free OpenRouter models (Qwen 3.6, Llama 3.3 70B, Hermes 405B, etc.) are inaccessible
- User specifically asked to test Qwen 3.6 Plus:free but couldn't

**Why:** Account may be expired, suspended, or key revoked. Not investigated yet.

**How to apply:** Don't attempt OpenRouter models until the key is refreshed. If user asks about free models, suggest Gemini (working) or note that OpenRouter needs a new key. Check `llm keys list` for status.
