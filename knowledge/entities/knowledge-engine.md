---
title: Knowledge Engine
type: entity
updated: 2026-04-04
sources: [raw/karpathy-llm-wiki-2026.md]
links: [concepts/llm-wiki.md, concepts/knowledge-compounding.md, entities/memory-curator.md, decisions/memory-system.md]
---

# Knowledge Engine

`/root/overlord/knowledge-engine.js` — the core module powering Overlord's wiki system.

## What It Does

Manages the `knowledge/` directory as a structured, searchable wiki. No embeddings, no RAG infrastructure — keyword search over markdown files with prompt injection into admin conversations.

## Key Operations

| Function | Purpose |
|----------|---------|
| `searchKnowledge(query)` | Keyword search across all wiki pages, returns ranked results with snippets |
| `getKnowledgeContext(query)` | Format search results for prompt injection (2000 char budget) |
| `getKnowledgeMap()` | Compact INDEX.md for system prompts |
| `writeKnowledge(category, topic, content)` | Create/overwrite a wiki page |
| `appendKnowledge(category, topic, section)` | Append to existing page |
| `regenerateIndex()` | Rebuild INDEX.md from all files |
| `saveSource(name, content)` | Save immutable source to raw/ |
| `appendLog(action, title, details)` | Append timestamped entry to log.md |
| `getIngestContext()` | Full wiki state for LLM during ingest |
| `fileAnswer(title, content, category, sources)` | File a query answer as a wiki page |
| `lintWiki()` | Health-check: orphans, stale, stubs, dead links, uningested |
| `findMentions(term)` | Find all pages mentioning a term |
| `findOrphanPages()` | Pages with no inbound links |
| `getSynthesisPrompt()` | Generate the weekly synthesis task prompt |

## Wiki Categories

7 content categories + raw sources:
- `patterns/` — recurring solutions, error→fix mappings
- `decisions/` — architecture choices and rationale
- `insights/` — generated analysis, cross-project patterns
- `projects/` — per-project knowledge
- `entities/` — people, services, tools, APIs
- `concepts/` — topics, methodologies, design patterns
- `comparisons/` — filed analyses and query answers
- `raw/` — immutable source documents (not a category, separate layer)

## How It Integrates

- **Prompt injection:** `getKnowledgeContext()` called during admin message handling in index.js. Relevant wiki snippets injected as `[KNOWLEDGE BASE]` section.
- **INDEX.md:** Always loaded into admin context so the bot knows what it knows.
- **Write-back:** Bot writes to knowledge files after solving non-trivial problems.
- **Weekly synthesis:** `getSynthesisPrompt()` generates a task for the Wednesday synthesis cycle.
- **Lint:** `lintWiki()` runs weekly after synthesis, also available via `mem lint` and `/kb lint`.

## Relationship to Memory System

The knowledge engine and [memory system](../decisions/memory-system.md) are complementary:
- Memory (SQLite) = reactive, atomic facts, auto-extracted
- Wiki (markdown) = generative, synthesized pages, deliberately maintained

Both inject into prompts. Both compound over time. Different granularity, different purpose.
