# Overlord — Project Knowledge

## Known Quirks
- index.js is ~5000 lines. Massive single file. Reading it speculatively wastes context. Always grep first, then targeted line-range reads.
- The `.env` file has API keys for every service. Must be `chmod 600`. Never commit.
- The `auth/` directory holds WhatsApp session state. Deleting it forces QR re-link.
- Session IDs are per-chat JID. Stale sessions can pollute context. `/clear` resets.

## Recent Fixes (2026-04-03)
- **Personality injection:** IDENTITY.md was never loaded. Now loaded at startup, injected into all system prompts.
- **Group personality wipeout:** Power users in groups got generic "helpful, witty, concise." Now get full Overlord identity.
- **Patrol uselessness:** Thresholds were so high nothing triggered. Lowered across the board. Reports now show details.

## Architecture Notes
- Message pipeline: WhatsApp → Baileys → Parser → Media Download → Triage → Batcher → Router → Claude CLI → Response → WhatsApp
- Three Docker services: overlord (app), overlord-db (PostgreSQL), lightpanda (browser)
- 66 skills in skills/ directory — self-contained modules
- Memory: SQLite (memory-v2.db) with episodic/semantic/procedural tiers — see [memory system decisions](../decisions/memory-system.md)
- Wiki: markdown knowledge system via [knowledge engine](../entities/knowledge-engine.md), following [LLM wiki pattern](../concepts/llm-wiki.md)
- Scheduler: cron-based with 20+ scheduled tasks

## Performance Profile
- Typical memory usage: 400-800MB (Node.js process) + 200-500MB per Claude CLI child
- Container limit: 4GB. Two concurrent Claude CLI sessions is the practical max.
- Startup time: ~5-8 seconds (DB init, schema checks, scheduler setup, WhatsApp connect)
