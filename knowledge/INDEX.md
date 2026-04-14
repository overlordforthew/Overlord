# Knowledge Base — Overlord

Master index for Overlord's compounding knowledge system. This file is injected into every admin conversation so the bot knows what it knows and where to find it.

**How this works:** Overlord reads files, solves problems, and writes back what it learned. Every session compounds into the next.

**Stats:** 16 knowledge files across 7 categories. Last updated: 2026-04-13.

## Patterns (recurring solutions)
- [Docker Deploy](patterns/docker-deploy.md) — - Overlord container has 4GB memory limit. Heavy tasks (multi-file Claude CLI se
- [Error Resolution](patterns/error-resolution.md) — - **SIGTERM (code 143):** Out of memory. Check `docker stats` for memory usage. 
- [Performance](patterns/performance.md) — - 4-core AMD EPYC, 8GB RAM, 80GB SSD
- [Whatsapp Baileys](patterns/whatsapp-baileys.md) — - Baileys uses WebSocket to WhatsApp servers. Connections drop regularly — this 

## Decisions (why things are the way they are)
- [Architecture](decisions/architecture.md) — - Claude CLI gives the bot full tool access: file reads, writes, grep, bash, web
- [Memory System](decisions/memory-system.md) — 1. **Episodic:** Per-user conversational facts. "Nami prefers Japanese for conte
- [Model Routing](decisions/model-routing.md) — 1. **v1:** Single model (Opus). Simple but expensive for trivial messages.

## Insights (generated analysis)
- [Cross Project](insights/cross-project.md) — All projects share: Hetzner CX33 server, Traefik reverse proxy, Coolify deployme
- [Synthesis Latest](insights/synthesis-latest.md) — This is the first entry in the knowledge system. No synthesis has run yet. The w

## Projects (per-project knowledge)
- [Overlord](projects/overlord.md) — - index.js is ~5000 lines. Massive single file. Reading it speculatively wastes 

## Entities (people, services, tools, APIs)
- [Andrej Karpathy](entities/andrej-karpathy.md) — AI researcher, former Tesla AI director, OpenAI founding team. Known for neural 
- [Knowledge Engine](entities/knowledge-engine.md) — `/root/overlord/knowledge-engine.js` — the core module powering Overlord's wiki 
- [Memory Curator](entities/memory-curator.md) — `/root/overlord/memory-curator.js` (348 lines) — Opus-powered extraction of dura

## Concepts (topics, methodologies, design patterns)
- [Knowledge Compounding](concepts/knowledge-compounding.md) — The principle that each interaction should leave the system smarter than before.
- [Llm Wiki](concepts/llm-wiki.md) — A pattern for building persistent knowledge bases where the LLM incrementally bu

## Comparisons (filed analyses and query answers)
- [Wiki Vs Overlord Memory](comparisons/wiki-vs-overlord-memory.md) — Analysis performed 2026-04-04 when evaluating Karpathy's LLM Wiki blueprint agai

## Raw Sources
1 immutable source documents in raw/. These are read-only — the wiki synthesizes from them.
- [karpathy-llm-wiki-2026](raw/karpathy-llm-wiki-2026.md) (2026-04-04)

## Wiki Operations
- **Ingest:** Drop a source into raw/, then process it — create/update entity, concept, and topic pages. Touch 10-15 pages per source.
- **Query:** Search the wiki, synthesize answers. File good answers back as comparisons/ pages.
- **Lint:** Health-check for orphans, stale pages, dead links, stubs, uningested sources.
- **Write-back:** After solving problems, update relevant pages. Cross-reference with markdown links.
- **Synthesis:** Weekly automated synthesis reviews recent conversations and generates insights.