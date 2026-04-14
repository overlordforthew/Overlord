---
title: Knowledge Compounding
type: concept
updated: 2026-04-04
sources: [raw/karpathy-llm-wiki-2026.md]
links: [concepts/llm-wiki.md, decisions/memory-system.md, entities/knowledge-engine.md, entities/memory-curator.md]
---

# Knowledge Compounding

The principle that each interaction should leave the system smarter than before. Knowledge accumulates, cross-references build, and synthesis deepens over time — rather than being stateless or ephemeral.

## Two Forms in Overlord

### Reactive Compounding (Memory System)
The [memory curator](../entities/memory-curator.md) auto-extracts facts from every conversation. Importance decays over time, frequently-accessed memories get boosted. This captures *what happened* — corrections, decisions, facts about people.

- Storage: SQLite (`data/memory-v2.db`)
- Extraction: Opus via OpenRouter after each conversation
- Lifecycle: decay/boost/prune/dedup daily
- Scope: atomic facts, not synthesized understanding

### Generative Compounding (Wiki)
The [LLM wiki](../concepts/llm-wiki.md) pattern. The LLM builds and maintains synthesized pages — entity profiles, concept maps, comparisons, decision rationale. Each source ingested and each good question answered enriches the wiki.

- Storage: markdown files in `knowledge/`
- Extraction: deliberate ingest workflow (LLM processes source across 10-15 pages)
- Lifecycle: lint cycle catches orphans, stale pages, contradictions
- Scope: synthesized, interlinked understanding

## Why Both Matter

Reactive catches the ephemeral — "Gil prefers single PRs for refactors." Generative builds the durable — a page on Overlord's architecture that synthesizes dozens of decisions into a coherent picture. Neither replaces the other.

The gap before the wiki pattern was that reactive compounding was working (memory-curator, consolidator) but generative compounding was aspirational. The [knowledge engine](../entities/knowledge-engine.md) had write-back rules but only 10 sparse files. The wiki pattern provides the discipline and tooling to make generative compounding real.
