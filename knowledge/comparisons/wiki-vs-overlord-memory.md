---
title: LLM Wiki Pattern vs Overlord's Pre-Existing Memory System
type: comparison
updated: 2026-04-04
sources: [raw/karpathy-llm-wiki-2026.md]
links: [concepts/llm-wiki.md, concepts/knowledge-compounding.md, entities/knowledge-engine.md, entities/memory-curator.md, decisions/memory-system.md]
filed_from: query
---

# LLM Wiki Pattern vs Overlord's Pre-Existing Memory System

Analysis performed 2026-04-04 when evaluating Karpathy's LLM Wiki blueprint against Overlord's existing knowledge architecture.

## What Overlord Already Had

| Component | Status | Notes |
|-----------|--------|-------|
| Schema layer (CLAUDE.md) | Strong | Better than Karpathy's spec — detailed, multi-section |
| Index file (INDEX.md) | Working | Auto-regenerated, injected into admin prompts |
| Wiki directory structure | Existed | 4 categories, 10 files, 278 lines total |
| Search + prompt injection | Working | Keyword search, 2000 char budget |
| Memory extraction | Working | Opus-powered curator, auto-extracts from every conversation |
| Memory maintenance | Working | Daily consolidator: decay/boost/prune/dedup |
| Vector search | Working | Qdrant + Gemini 768-dim (exceeds Karpathy's BM25 recommendation) |
| CLI tools | Working | `mem` CLI with search, recall, save, stats, consolidate |

## What Overlord Was Missing

| Gap | Impact | Resolution |
|-----|--------|------------|
| No raw sources layer | Sources absorbed, not preserved | Added `knowledge/raw/` (immutable) |
| No ingest pipeline | No deliberate multi-page synthesis from sources | Added `saveSource()`, `getIngestContext()`, workflow in CLAUDE.md |
| Atomic facts, not synthesized pages | 10 sparse files vs rich interlinked wiki | Added entities/, concepts/, comparisons/ categories |
| No filing answers back | Good synthesis lost to chat history | Added `fileAnswer()` helper |
| No lint operation | No wiki health-checking | Added `lintWiki()`, `mem lint`, `/kb lint`, weekly cron |
| No log.md | No chronological wiki changelog | Added `knowledge/log.md`, `appendLog()` |
| No cross-referencing | Pages standalone, no links between them | Added markdown link convention, `findMentions()`, `findOrphanPages()` |

## What Overlord Had That Karpathy Doesn't Mention

- Vector embeddings (Qdrant + Gemini) — Karpathy suggests BM25/qmd, we have hybrid vector+keyword
- Automatic extraction from conversations — his wiki requires deliberate ingest, ours also auto-captures
- Per-user episodic memory (JID-scoped, importance-weighted) — his is a personal wiki, ours is multi-user
- Importance lifecycle (decay floors by type, boost on access, auto-archive)
- PostgreSQL conversation log (full audit trail)

## The Philosophical Gap

**Reactive vs generative.** Overlord's memory system captured what happened (facts from conversations). Karpathy's wiki builds understanding (synthesized, interlinked pages). Both are needed:

- Memory (reactive) = stenographer. Records facts.
- Wiki (generative) = editor. Synthesizes understanding.

The upgrade preserved the reactive layer and added the generative layer on top. Same codebase, same `knowledge-engine.js`, expanded from 4 categories to 7 + raw sources.
