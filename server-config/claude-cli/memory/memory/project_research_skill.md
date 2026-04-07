---
name: research-skill-v2
description: /research skill built 2026-04-06 — multi-source, multi-engine, citation-enforced research with persistent lab notebook.
type: project
---

Built `/research` v2 skill on 2026-04-06. Inspired by Feynman project's citation discipline.

**Architecture:**
- 4 parallel search lanes: web, academic, code/GitHub, contrarian
- 3 engine tiers: `opus` (~$12-16), `haiku` (~$0.80, default), `gemini` (~$0, free)
- Iteration loop: cheap models do fast rounds, orchestrator analyzes gaps between rounds
- Citation iron law: every claim needs a `[source](url)` or gets cut
- Persistent lab notebook at `/root/.claude/research/` with INDEX.md
- Output formats: brief, executive, json, thread
- Flags: --depth, --focus, --format, --engine, --time, --continue

**Files:**
- SKILL.md: `/root/.claude/skills/research/SKILL.md`
- Script: `/root/.claude/skills/research/scripts/research-lane.sh` (Gemini engine, uses `llm` CLI)

**Test results (2026-04-06, "vessel monitoring" query):**
- Opus: 48 sources, 42 confirmed, 10min wall time, ~$14
- Haiku: 38 findings in 2 rounds, 100s, ~$0.35
- Gemini: 24 findings in 2 rounds, 180s, $0 — but 58% URLs unverified (hallucinated)

**Why:** User saw Feynman project (getcompanion-ai/feynman), wanted a streamlined version as a skill. Key value: citation enforcement + parallel multi-source search.

**How to apply:** Default to `--engine haiku`. Suggest `--engine opus` only for critical decisions. Note Gemini's URL hallucination weakness when recommending it.
