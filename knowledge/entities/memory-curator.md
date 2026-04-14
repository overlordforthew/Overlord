---
title: Memory Curator
type: entity
updated: 2026-04-04
sources: []
links: [concepts/knowledge-compounding.md, decisions/memory-system.md, entities/knowledge-engine.md]
---

# Memory Curator

`/root/overlord/memory-curator.js` (348 lines) — Opus-powered extraction of durable facts from conversations.

## How It Works

After each conversation, `extractAndStore()` sends the message pair to Claude Opus via OpenRouter. Opus extracts two types of facts:

- **Episodic** (per-user): corrections, standing orders, decisions, personal facts
- **Semantic** (global): system knowledge, tool capabilities, infrastructure details

Each fact gets importance-scored:
- Standing orders ("always X", "never Y"): 9-10
- Corrections ("no", "don't", "stop"): 9
- Decisions: 7-8
- Facts: 3-6
- Caps: 5 episodic + 3 semantic per conversation

## Deduplication

Before storing, each fact is embedded via Gemini (768-dim) and checked against Qdrant with 0.85 similarity threshold. Matches update the existing observation (importance boost) rather than creating duplicates.

## Integration

- Called from index.js after every assistant response
- Stores to `data/memory-v2.db` observations table
- Works with [memory consolidator](../decisions/memory-system.md) for daily decay/boost/prune
- Feeds into prompt injection via `retrieveMemories()` hybrid search

## Role in Knowledge Compounding

The curator is the reactive layer of [knowledge compounding](../concepts/knowledge-compounding.md). It captures what happened — but doesn't synthesize. The [wiki](../concepts/llm-wiki.md) handles synthesis.
