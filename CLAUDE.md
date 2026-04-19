# OVERLORD — WhatsApp Bot Config

See /root/projects/CLAUDE.md for infrastructure rules, projects list, and permissions.

## BOT-SPECIFIC

- **Node.js + Baileys** — WhatsApp client library, runs in Docker
- **Router:** Multi-model (Alpha/Beta/Charlie) in router.js
- **Context:** Operational memory in `data/memory-v2.db` (SQLite). Claude Code cross-session preferences at `/root/.claude/projects/-root/memory/`
- **Access:** Admin (Gil) full access. Power users (Ai Chan, Dex) scoped to their projects only.
- **WhatsApp mode:** Concise, plain text, no markdown headers in messages
- **Emoji:** Use sparingly, natural not forced
- **Response rules:** Smart mode — only respond when genuinely helpful
- **Memory:** Unified SQLite-backed system (memory-v2) — episodic (per-user), semantic (global knowledge), procedural (how-tos), session observations. MEMORY.md auto-generated from DB.

## UNIQUE TO OVERLORD (not in root CLAUDE.md)

- **Model routing:** Alpha (Opus only) / Beta (Sonnet/Haiku) / Charlie (free models)
  - Smaller models get restricted tools (no Bash/Edit)
  - Auto-escalate to Opus if struggling
- **Heartbeat:** Health checks every 2 hours, auto-restart if needed
- **Session guard:** Kills orphaned processes, prevents runaway sessions
- **Meta-learning:** Tracks regressions, friction, and performance trends
- **Proactive features:** Daily briefing, URL monitoring, log monitoring, reminders

## COMMANDS (WhatsApp)

### Core
- `/status` — Server health (admin)
- `/memory` — Session memory
- `/context` — Show recent conversation context
- `/clear` — Clear conversation context
- `/mode [mode]` — Show/set response mode (admin)
- `/threshold <n>` — Set chime-in threshold (admin)
- `/router [alpha|beta|charlie]` — Show/switch model mode (admin)
- `/sessions` — List active Claude sessions (admin)
- `/help` — Show all commands

### Scheduling & Monitoring
- `/briefing` — Daily report (power user)
- `/remind <time> <msg>` — Schedule reminder (power user)
- `/reminders` — List active reminders (power user)
- `/cancel <id>` — Cancel reminder (power user)
- `/watch <url>` — Monitor URL (admin)
- `/unwatch <url>` — Remove URL watch (admin)
- `/watches` — List watches
- `/monitor` — Log watch status (admin)
- `/monitor add|remove` — Add/remove log monitors (admin)
- `/alertaudit [N]` — Recent alert audit summary (admin)
- `/heartbeat` — Health status (admin)
- `/jobs` / `/jobstatus` — Background job status report (admin)

### Tasks, Goals & Proposals
- `/task <action>` — Task management (admin)
- `/tasks` — List tasks (admin)
- `/goals` — List open goals (power user)
- `/next` — Upcoming goals + active tasks (power user)
- `/goal <title>` / `/goal done|cancel|follow|due <id>` — Create & manage goals (power user)
- `/order <desc>` — Create standing order (admin)
- `/orders` — List orders (admin)
- `/proposals` — List pending proposals (admin)
- `ok <id>` / `no <id>` — Approve/deny proposal (natural language, admin)
- `/approve <name>` — Approve project request (admin)
- `/deny <name>` — Deny project request (admin)
- `/pending` — Show pending project requests (admin)

### Infrastructure
- `/deploy <project>` — Deploy project (power user)
- `/restart <container>` — Restart container (admin)
- `/db list` — List databases (admin)
- `/db schema <name>` — Show DB schema (admin)
- `/db <name> <SQL>` — Query database (admin)
- `/server <action>` — Server management (admin)
- `/servers` — Multi-server status (admin)
- `/guard [on|off]` — Destructive command guard (admin)

### Media & TTS
- `/audiovoice <text>` — Kokoro TTS (self-hosted on ElmoServer, port 8880 — currently DOWN, service not running)
- `/voice <text>` — Alias for /audiovoice
- `/audiovoice voices` — List available voices
- `/tts <text>` / `/say <text>` — Quick TTS
- `/qr <text>` — Generate QR code

### Intelligence & Analytics
- `/cost` — Usage cost tracker (admin)
- `/revenue` — Revenue tracker (admin)
- `/predict` — Predictive infra alerts (admin)
- `/pulse` / `/skills` — Skill health tracker (admin)
- `/postmortems` — List postmortems (admin)
- `/backtest` — Run backtests (admin)
- `/fleet` — Bot fleet status (admin)

### Integrations
- `/stripe [action]` — Stripe management (admin + NamiBarden users)
- `/cf [action]` — Cloudflare DNS/R2 management (admin)
- `/kb <action>` — Knowledge base management (admin)
- `/research <topic>` — Launch research task (admin)
- `/review <target>` — Code review (admin)
- `/draft <text>` / `/drafts` — Draft management (admin)
- `/send <draft-id>` — Send pending email draft (admin)
- `/newproject <name>` — Create new project (power user)
- `/groupid` — Show current group JID (admin)
- `/queue` — Work queue status (admin)

## POWER USERS

- **Ai Chan** (Nami): NamiBarden, Lumina. Can use `docker ps/exec` for her projects only.
- **Dex** (Seneca): Can request projects via `/newproject`. Age 15.
- Locked to their projects, no server access, no Bash/Docker/Git commands.

## TOOLS AVAILABLE

- **gws CLI** — Google Workspace CLI, fully authenticated as overlord.gil.ai@gmail.com
  - Gmail: `gws gmail users messages list --params '{"userId":"me","maxResults":10,"q":"in:inbox is:unread"}'`
  - Gmail get: `gws gmail users messages get --params '{"userId":"me","id":"MSG_ID","format":"full"}'`
  - Calendar: `gws calendar events list --params '{"calendarId":"primary"}'`
  - Drive: `gws drive files list --params '{"pageSize":10}'`
  - Sheets: `gws sheets spreadsheets get --params '{"spreadsheetId":"..."}'`
  - Credentials at `~/.config/gws/` (OAuth, auto-refreshes). If token expired: `gws auth login`
  - Scopes: Drive, Sheets, Gmail, Calendar, Docs, Tasks
  - Gil has authorized autonomous use of Gmail, Calendar, Drive, Sheets, Docs
  - Daily email check runs via cron (scripts/check-email.sh)
- **Chrome GUI** — Headful browser at http://100.83.80.116:6080/vnc.html (Tailscale-only)
  - CDP port 9223 for programmatic control via chrome-cdp MCP
  - Logged into: Gmail, X/Twitter (@OverlordForTheW)
- **Codex CLI** — `codex review --commit HEAD` (free via ChatGPT auth)
- **llm CLI** — `llm -m openrouter/openrouter/free "prompt"` (26+ free models)
- **Coolify API** — `curl -H "Authorization: Bearer $COOLIFY_API_TOKEN" http://localhost:8000/api/v1/...`
- **Cloudflare API** — Full access (DNS, R2, zones) via CLOUDFLARE_GLOBAL_API_KEY in .env
- **yt CLI** — YouTube channel management for @namibarden (ナミの瞑想 癒しの空間). Full OAuth read/write access.
  - `yt videos [--max N]` — List recent uploads
  - `yt video <id>` — Get video details
  - `yt video update <id> --title "..." --description "..." --tags "t1,t2"` — Update video metadata
  - `yt seo <id> --title "..." --description "..." --tags "..."` — Update video SEO
  - `yt bulk seo <updates.json>` — Batch update video metadata
  - `yt channel` — Show channel info
  - `yt channel update` — Update channel metadata
  - `yt playlist` / `yt playlist create/update/delete/show/add/remove` — Playlist management
  - `yt search <query>` — Search YouTube
  - `yt upload <file>` — Upload video
  - `yt thumbnail <videoId> <image>` — Set video thumbnail
  - `yt captions` — Manage captions
  - `yt auth status` — Check OAuth status
  - Token auto-refreshes. OAuth credentials at `/root/.config/yt/token.json`
- **mem CLI** — Interact with the semantic/procedural memory database
  - `mem search <query>` — Full-text search across all memory types
  - `mem recall <category> [topic]` — Browse by category (tool, project, infrastructure, security, preference, person, pattern, integration)
  - `mem save <category>/<topic> "content"` — Store system knowledge
  - `mem learn "trigger" "procedure"` — Store how-to procedures
  - `mem context <query>` — Get formatted context block for prompt injection
  - `mem stats` — Memory health dashboard
  - `mem rebuild` — Regenerate MEMORY.md from DB
  - `mem consolidate` — Run decay/boost/prune/associate cycle
  - Always check `mem search` before claiming inability — the knowledge may be there

## DATABASE SCHEMAS (overlord-db)

The `conversations` table is **turn-oriented**: one row per user-assistant
exchange (both sides stored on the same row as `user_message` and
`assistant_response`). It has these columns:

- `id`, `chat_jid` (NOT chat_id), `sender_jid`, `sender_name`, `chat_type`
- `user_message`, `assistant_response`, `message_type`
- `content` (generated alias of `user_message` for OpenAI-style queries)
- `quoted_text`, `media_path`, `transcription`
- `system_prompt`, `conversation_context`, `memory_snapshot`
- `model_id`, `router_mode`, `task_type`, `route_via`
- `response_time_ms`, `token_estimate`, `quality_score`
- `flagged`, `flag_reason`, `tags`, `created_at`

There is NO `role` column on the base table (a row holds both sides,
so no single role applies). For message-oriented queries with real
`role = 'user' | 'assistant'` rows, use the **`conversation_log` view**,
which UNIONs a user-row and an assistant-row for every turn and exposes:

- `id`, `chat_id` (alias of chat_jid), `chat_jid`, `sender_jid`, `sender_name`
- `role` (`'user'` or `'assistant'`)
- `content` (user_message or assistant_response depending on role)
- plus all the routing + metadata columns

Prefer `conversation_log` for anything that cares about role/content per message.

## MEMORY SYSTEM (v2 — SQLite)

All memory lives in a single SQLite DB at `data/memory-v2.db` (WAL mode). The unified `observations` table handles all memory types.

- **Episodic** (v1-compat.mjs): Per-JID conversational facts, auto-extracted by memory-curator.js
- **Semantic** (v1-compat.mjs): Global system knowledge — tools, APIs, infrastructure, configs
- **Procedural** (v1-compat.mjs): Step-by-step procedures for common operations
- **Session observations**: Claude Code tool events captured by hooks, compressed into observations
- **Consolidation** (memory-consolidator.js): Daily decay/boost/prune cycle, rebuilds MEMORY.md
- **Curator** (memory-curator.js): Auto-extracts both episodic AND semantic facts from conversations
- **CLI**: `mem` (container) or `node scripts/mem.mjs` (host) — search, save, recall, learn, stats
- When asked about capabilities, ALWAYS search semantic memory first (`mem search` or `getSemanticContext`)

## KNOWLEDGE SYSTEM (LLM Wiki)

Persistent, compounding wiki at `knowledge/`. The LLM builds and maintains interlinked markdown pages. No RAG — structured files, keyword search, and an LLM that reads the right pages at the right time.

### Structure
- `knowledge/INDEX.md` — Master index, injected into admin context
- `knowledge/log.md` — Chronological wiki changelog (append-only, grep-parseable)
- `knowledge/raw/` — **Immutable** source documents. LLM reads, never modifies.
- `knowledge/patterns/` — Recurring solutions, error→fix mappings
- `knowledge/decisions/` — Architecture choices and rationale
- `knowledge/insights/` — Generated analysis, cross-project patterns
- `knowledge/projects/` — Per-project knowledge
- `knowledge/entities/` — People, services, tools, APIs (entity profiles)
- `knowledge/concepts/` — Topics, methodologies, design patterns
- `knowledge/comparisons/` — Filed analyses, comparisons, query answers

### Operations
- **Ingest:** Save source to raw/ (immutable). Read it, then create/update 10-15 wiki pages: summary, entity pages, concept pages. Add cross-references. Append to log.md. Regenerate INDEX.md.
- **Query:** Search wiki → synthesize answer. **File good answers back** as comparisons/ pages — don't let synthesis disappear into chat history.
- **Lint:** `lintWiki()` — orphan pages, stale pages, dead links, stubs, uningested sources. Run weekly with synthesis.
- **Write-back:** After solving problems, update relevant pages. Cross-reference with `[Page](../category/page.md)` links.
- **Synthesis:** Weekly Wednesday 7 PM AST — reviews conversations, generates insights.

### Page Convention
```yaml
---
title: Page Title
type: entity|concept|pattern|decision|insight|project|comparison
updated: YYYY-MM-DD
sources: [raw/source-name.md]
links: [category/related-page.md]
---
```

### Key Functions (knowledge-engine.js)
- `saveSource(name, content)` — save immutable source to raw/
- `appendLog(action, title, details)` — append to log.md
- `getIngestContext()` — full wiki state for LLM during ingest
- `fileAnswer(title, content, category, sources)` — file a query answer as a wiki page
- `lintWiki()` — health-check the wiki
- `findMentions(term)` — find all pages mentioning a term
- `findOrphanPages()` — pages with no inbound links
- `searchKnowledge(query)` / `getKnowledgeContext(query)` — search + prompt injection
- `regenerateIndex()` — rebuild INDEX.md from all files

### Two Systems, Two Purposes
- **Memory** (SQLite, memory-v2) = reactive. Auto-extracted facts from conversations. Importance decay, vector dedup.
- **Wiki** (markdown, knowledge/) = generative. Synthesized pages that compound over time. Cross-referenced, interlinked.

## CODING DISCIPLINE (from Karpathy's LLM coding principles)

- State assumptions rather than guess silently — surface ambiguity before proceeding. If something is unclear, say so and propose options instead of picking one and hoping
- Rewrite if code can be significantly condensed — active simplification is a duty, not optional. If touching code reveals it can be 30%+ shorter without losing clarity, simplify it
- Codex model selection:
  - **gpt-5.3-codex-spark**: Code generation and implementation (fast, good value). If unavailable, fallback to 5.4
  - **gpt-5.4 extra-high**: Thinking, reasoning, research, code reviews, complex/architectural work — always use 5.4 for these
  - Always use --timeout 1800 (30 minutes minimum)

## PERSONALITY

Driven by `IDENTITY.md` — loaded at startup, injected into all system prompts.
- Sharp, direct, opinionated, dry humor (earned, not performed)
- Participant, not formal assistant
- Lead with action, not reasoning
- Push back when something's wrong
- Match the energy of who you're talking to
