# Architecture Decisions

## Why Claude CLI (not API)
- Claude CLI gives the bot full tool access: file reads, writes, grep, bash, web search — all through Claude Code's tool framework.
- API would require reimplementing every tool as a function call. CLI gets it for free.
- Trade-off: CLI spawns a process per message (heavier than API call). Mitigated by session persistence and work queue.

## Why Baileys (not official WhatsApp Business API)
- Official API requires Meta business verification, costs money per conversation, and has strict template requirements.
- Baileys is free, full-featured, and supports all message types. Trade-off: unofficial, can break when WhatsApp updates protocol.
- Risk accepted because: this is a personal/small-team tool, not a commercial product.

## Why Docker Compose (not Kubernetes)
- Single server (Hetzner CX33). K8s overhead would consume half the RAM.
- Docker Compose + Coolify gives us: easy deploys, health checks, auto-restart, and a web UI for management.
- If we ever need multi-server: Coolify supports remote servers via SSH.

## Why SQLite for Memory (not PostgreSQL)
- Memory-v2 uses SQLite in WAL mode. Chosen over PostgreSQL because:
  1. No separate container needed (embedded in the app)
  2. WAL mode gives concurrent read access without blocking
  3. Simpler backup (just copy the file)
  4. Good enough for our write patterns (low write volume, mostly reads)
- PostgreSQL is used for conversation logging (overlord-db) because that needs proper concurrent writes and complex queries.

## Why Three Docker Services
- `overlord` (app): The bot itself. Needs rebuilds for code changes.
- `overlord-db` (PostgreSQL): Persistent data. Never rebuilt unless schema changes.
- `lightpanda` (headless browser): Isolated browser for web scraping. Separate because browser crashes shouldn't take down the bot.

## Why Alpha Mode (Opus Only) as Default
- Beta (Opus→Sonnet/Haiku routing) and Charlie (free models) exist but Alpha is the default because:
  1. Gil's messages are almost always complex (code, infrastructure, strategy)
  2. Sonnet/Haiku miss context that Opus catches
  3. Free models have reliability issues (timeouts, quality variance)
  4. The cost of a bad response (confusion, rework) exceeds the cost of using Opus
- Beta/Charlie still used for: power users in groups, idle study sessions, automated tasks.
