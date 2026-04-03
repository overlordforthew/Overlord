# Knowledge Base — Overlord

Master index for Overlord's compounding knowledge system. This file is injected into every admin conversation so the bot knows what it knows and where to find it.

**How this works:** Overlord reads files, solves problems, and writes back what it learned. Every session compounds into the next. No RAG, no embeddings — just structured files and an LLM that reads the right ones at the right time.

## Patterns (recurring solutions)
- [Docker & Deploy](patterns/docker-deploy.md) — container patterns, deploy gotchas, restart recovery
- [WhatsApp & Baileys](patterns/whatsapp-baileys.md) — connection handling, message quirks, reconnect patterns
- [Error Resolution](patterns/error-resolution.md) — error→root cause→fix mappings across all projects
- [Performance](patterns/performance.md) — memory limits, timeout tuning, resource patterns

## Decisions (why things are the way they are)
- [Architecture](decisions/architecture.md) — system design choices and their rationale
- [Model Routing](decisions/model-routing.md) — Alpha/Beta/Charlie evolution, what worked, what didn't
- [Memory System](decisions/memory-system.md) — why SQLite, why three tiers, consolidation design

## Insights (generated analysis)
- [Latest Synthesis](insights/synthesis-latest.md) — most recent weekly synthesis
- [Cross-Project Patterns](insights/cross-project.md) — patterns that span multiple projects

## Projects (per-project knowledge)
- [Overlord](projects/overlord.md) — bot-specific knowledge, quirks, known issues
- [NamiBarden](projects/namibarden.md) — website patterns, nginx quirks, deploy flow
- [BeastMode](projects/beastmode.md) — fitness app patterns
- [Lumina](projects/lumina.md) — journaling app, React+Express patterns
- [SurfaBabe](projects/surfababe.md) — e-commerce patterns, webhook deploy
- [Elmo](projects/elmo.md) — drafting app patterns
- [MasterCommander](projects/mastercommander.md) — marine dashboard, docker cp deploy

## How to Use This
- **Reading:** Search by keyword or browse by category. INDEX.md tells you where to look.
- **Writing back:** After solving a problem, discovering a pattern, or making a decision — update the relevant file. Create new files if no existing one fits. Always update INDEX.md if you add a new file.
- **Synthesis:** Weekly automated synthesis reviews recent conversations and generates insights.
