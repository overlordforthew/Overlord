---
name: Crossreview — Codex is primary reviewer
description: Gil has a $20/mo Codex CLI plan. Crossreview upgraded to use Codex as primary external reviewer, free models as secondary.
type: feedback
---

Codex CLI ($20/mo ChatGPT plan) is now the PRIMARY external reviewer in /crossreview. Free OpenRouter models are secondary — one free model for diversity, but Codex alone is sufficient if free models are rate-limited.

**Why:** Gil doesn't fully trust free model quality. Codex uses GPT models via paid ChatGPT auth — known quantity, reliable, no rate limits.

**How to apply:** Always run `codex review` in crossreview. Free model is optional diversity. Don't block on free model availability.
