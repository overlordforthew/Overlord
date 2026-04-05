---
name: Overlord LLM Wiki System
description: Knowledge system upgraded from reactive memory to full LLM Wiki pattern (Karpathy blueprint). Architecture, files, functions, operations.
type: project
---

# Overlord LLM Wiki System

Built 2026-04-04. Evolved the existing `knowledge/` directory from 10 sparse files into a full LLM Wiki (Karpathy pattern).

**Why:** The existing memory system (SQLite, memory-v2) was reactive — auto-extracted atomic facts. The knowledge system had the right structure but was aspirational. The wiki pattern adds the generative layer — synthesized, interlinked pages that compound.

**How to apply:** When working on Overlord's knowledge or memory systems, understand the two-layer architecture. Memory (SQLite) = reactive facts. Wiki (markdown) = generative synthesis. Both inject into prompts, both compound, different purpose.

## What Was Built

### knowledge-engine.js — 7 new functions
- `saveSource(name, content)` — save immutable source to `knowledge/raw/`
- `listSources()` — enumerate raw sources
- `appendLog(action, title, details)` — append to `knowledge/log.md`
- `getIngestContext()` — full wiki state for LLM during ingest
- `findMentions(term)` — find all pages mentioning a term
- `findOrphanPages()` — pages with no inbound links
- `lintWiki()` — health-check (orphans, stale, stubs, dead links, uningested)
- `fileAnswer(title, content, category, sources)` — file query answer as wiki page

### Wiki Structure (knowledge/)
7 content categories + raw sources:
- `patterns/` — recurring solutions (4 files, pre-existing)
- `decisions/` — architecture rationale (3 files, pre-existing)
- `insights/` — generated analysis (2 files, pre-existing)
- `projects/` — per-project knowledge (1 file, pre-existing)
- `entities/` — people, services, tools, APIs (NEW)
- `concepts/` — topics, methodologies (NEW)
- `comparisons/` — filed analyses and query answers (NEW)
- `raw/` — immutable source documents (NEW)
- `INDEX.md` — auto-regenerated master index
- `log.md` — chronological append-only changelog

### CLI & Bot Commands
- `mem ingest <path>` — save source and show ingest context
- `mem lint` — wiki health report
- `/kb lint` — WhatsApp wiki health check

### Cron
- Weekly lint: Wednesday 23:30 UTC (30 min after synthesis)
- Daily index regen: 10:00 UTC

### Three Operations (Karpathy pattern)
1. **Ingest:** Save source to raw/ → LLM processes → creates/updates 10-15 wiki pages → log → regen index
2. **Query:** Search wiki → synthesize answer → file good answers back as comparisons/ pages
3. **Lint:** Orphan pages, stale pages, dead links, stubs, uningested sources

### First Ingest: Karpathy LLM Wiki Blueprint
- Source: `raw/karpathy-llm-wiki-2026.md`
- Created 6 new pages, updated 3 existing with cross-references (9 pages touched)
- All new pages have YAML frontmatter and markdown cross-reference links

### Page Convention
```yaml
---
title: Page Title
type: entity|concept|pattern|decision|insight|project|comparison
updated: YYYY-MM-DD
sources: [raw/source-name.md]
links: [category/related-page.md]
---
```

### Files Modified
- `knowledge-engine.js` — expanded CATEGORIES, added 7 functions, fixed frontmatter-aware description extraction
- `scripts/mem.mjs` — added `ingest` and `lint` commands
- `scheduler.js` — added weekly lint cron, updated imports
- `index.js` — added `/kb lint` command, updated imports
- `CLAUDE.md` (overlord) — rewrote KNOWLEDGE SYSTEM section with wiki docs
- `CLAUDE.md` (root) — updated Knowledge System section
