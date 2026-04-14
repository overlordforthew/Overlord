# Memory System Decisions

## Three-Tier Architecture
1. **Episodic:** Per-user conversational facts. "Nami prefers Japanese for content." "Gil's boat is in Chaguaramas."
2. **Semantic:** Global system knowledge. "Overlord container has 4GB limit." "Traefik config is at /data/coolify/proxy/dynamic/namibarden.yaml."
3. **Procedural:** Step-by-step how-tos. "To deploy MasterCommander: docker cp files into container."

## Why This Split
- Episodic is user-scoped — you don't inject Gil's preferences into Nami's context.
- Semantic is global — infrastructure facts are relevant regardless of who's asking.
- Procedural is action-oriented — when the bot needs to DO something, it needs steps, not facts.

## Consolidation (Daily)
- **Decay:** Old memories lose relevance score over time. Prevents stale facts from dominating.
- **Boost:** Frequently accessed memories get boosted. Used memories are useful memories.
- **Prune:** Below-threshold memories get deleted. Keeps the DB lean.
- **Associate:** Related memories get linked. Helps retrieval find clusters of relevant context.

## Memory vs Wiki (Knowledge)

Two layers of [knowledge compounding](../concepts/knowledge-compounding.md):

- **Memory (memory-v2.db):** Reactive. Auto-extracted by [memory curator](../entities/memory-curator.md). Atomic facts, importance-scored, vector-deduped. "This broke and we fixed it."
- **Wiki (knowledge/):** Generative. Maintained via [LLM wiki pattern](../concepts/llm-wiki.md). Synthesized, interlinked pages. "Here's why this keeps breaking, how it connects to X, and how to prevent it."

Memory feeds the wiki: recurring patterns should be promoted to knowledge pages. Good query answers get [filed back](../comparisons/wiki-vs-overlord-memory.md) as wiki pages.

The [knowledge engine](../entities/knowledge-engine.md) manages the wiki. The memory curator manages the DB. Both inject into prompts. Both compound over time. Different granularity, different purpose.

## MEMORY.md Generation
- Auto-generated from DB by memory-consolidator.js
- Includes top-scoring memories per category
- Truncated at 200 lines in Claude Code context
- Not the same as knowledge/INDEX.md (which is hand-curated and always complete)
