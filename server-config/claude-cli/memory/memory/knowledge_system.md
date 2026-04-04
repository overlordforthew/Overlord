---
name: Knowledge System
description: Compounding knowledge system built 2026-04-03. File-based, no RAG. knowledge/ directory + knowledge-engine.js + weekly synthesis.
type: project
---

## Architecture

Built based on Karpathy/Pawel Huryn approach: structured markdown files, INDEX.md as master index, LLM reads right files at right time and writes back.

**Three storage layers:**
| System | Storage | Purpose |
|--------|---------|---------|
| Conversation log | PostgreSQL (overlord-db) | Chat history |
| Memory v2 | SQLite (data/memory-v2.db) | Reactive facts (episodic/semantic/procedural) |
| Knowledge | Markdown files (knowledge/) | Curated patterns, decisions, insights — compounds over time |

## Key files
- `knowledge-engine.js` — search, inject, write, regenerate INDEX.md
- `knowledge/INDEX.md` — master index, injected into admin context
- `knowledge/patterns/` — docker-deploy, whatsapp-baileys, error-resolution, performance
- `knowledge/decisions/` — architecture, model-routing, memory-system
- `knowledge/insights/` — synthesis-latest, cross-project
- `knowledge/projects/` — per-project knowledge (overlord to start)

## How it works
1. Every admin message triggers keyword search of knowledge files → relevant snippets injected as `[KNOWLEDGE BASE]` in prompt
2. Admin system prompt instructs bot to write back after solving problems
3. Weekly synthesis (Wednesday 7 PM AST) spawns Claude CLI to review conversations and generate new knowledge
4. INDEX.md regenerates daily + on startup

**Why:** Gil wanted the system to compound — every session making the next one smarter. Memory was reactive (corrections), not generative (insights, patterns).

**How to apply:** If adding new knowledge categories or changing the injection, edit `knowledge-engine.js`. The Dockerfile must COPY both `knowledge-engine.js` and `knowledge/` directory.
