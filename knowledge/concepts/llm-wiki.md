---
title: LLM Wiki Pattern
type: concept
updated: 2026-04-04
sources: [raw/karpathy-llm-wiki-2026.md]
links: [concepts/knowledge-compounding.md, decisions/memory-system.md, entities/knowledge-engine.md]
---

# LLM Wiki Pattern

A pattern for building persistent knowledge bases where the LLM incrementally builds and maintains a wiki of interlinked markdown files, rather than re-deriving knowledge from raw documents on every query (RAG).

## Core Principles

1. **Persistent artifact** — the wiki is not a cache or index. It's a compounding product that gets richer with every source added and every question asked.
2. **LLM-maintained** — the LLM writes and maintains all wiki content. Humans curate sources, direct analysis, and ask questions.
3. **Three layers** — raw sources (immutable), wiki (LLM-generated), schema (CLAUDE.md conventions).
4. **Three operations** — ingest (process source → update pages), query (search → synthesize → file back), lint (health-check).
5. **Knowledge compiled, not re-derived** — cross-references, contradictions, and synthesis are pre-computed, not discovered at query time.

## How It Differs From RAG

| Aspect | RAG | LLM Wiki |
|--------|-----|----------|
| Knowledge state | Re-derived per query | Pre-compiled, persistent |
| Cross-references | Discovered at query time | Already built into pages |
| Contradictions | Might be missed | Flagged during ingest |
| Accumulation | None — stateless | Compounding over time |
| Maintenance cost | Zero (nothing to maintain) | Near-zero (LLM does it) |
| Multi-source synthesis | Hard (must find all chunks) | Easy (already synthesized) |

## Overlord Implementation

Overlord adopted this pattern on 2026-04-04, evolving the existing [knowledge engine](../entities/knowledge-engine.md) from a reactive fact store into a generative wiki. The implementation uses:

- `knowledge/` directory as the wiki layer
- `knowledge/raw/` as the immutable source layer
- `CLAUDE.md` + `INDEX.md` as the schema layer
- `knowledge-engine.js` for search, ingest helpers, lint, cross-referencing
- `log.md` for chronological tracking

The [memory system](../decisions/memory-system.md) (SQLite, memory-v2) coexists as a reactive layer — auto-extracted facts from conversations. The wiki is the generative layer — synthesized, interlinked pages.

## Origin

Published by [Andrej Karpathy](../entities/andrej-karpathy.md) on 2026-04-04. Inspired by Vannevar Bush's Memex (1945) — a personal knowledge store with associative trails. Bush envisioned the connections between documents being as valuable as the documents themselves. The LLM solves the maintenance problem Bush couldn't.
