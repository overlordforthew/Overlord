---
name: cost-conscious-model-routing
description: User strongly prefers cheap/free models for grunt work — Opus only for synthesis. Tested and validated 2026-04-06.
type: feedback
---

Use cheaper models for mechanical tasks (search, extraction, verification). Reserve Opus for synthesis and judgment.

**Why:** An exhaustive /research run on Opus cost ~$12-16. Same run with Haiku search lanes cost ~$0.80 with comparable quality. User explicitly said "This is too expensive to run on Opus or Codex."

**How to apply:**
- When spawning Agent subagents for search/extraction work, set `model: "haiku"` by default
- Only use Opus subagents when the task requires deep reasoning (synthesis, judgment, architecture)
- The /research skill has `--engine` flag: haiku (default), opus (quality), gemini (free)
- Comparative test results (2026-04-06): Haiku 30 findings/57s/$0.25 vs Gemini 15 findings/90s/$0 — Haiku wins on quality-per-dollar
