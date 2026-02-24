# Work Logs

## 2026-02-22

### Workspace Enhancement (Phase 1-4)
- Built full OVERLORD workspace structure around existing WhatsApp bot (NOT a rebuild)
- New workspace files: CLAUDE.md (enhanced), IDENTITY.md, USER.md, MEMORY.md, BRAIN.md, INBOX.md, PLAYBOOK.md, VOICE.md, STATUS.md, CHANGELOG.md
- 9 skill modules with SKILL.md each + 4 executable tool sets (monitoring, web-scraper, api-integrations, data-analysis)
- 6 utility scripts: health-check.sh, backup.sh, update-status.sh, morning-brief.sh, auto-journal.sh, codex-review.sh
- Dockerfile expanded: Docker CLI, GitHub CLI, Python 3 + pip packages, llm + OpenRouter plugin, Codex CLI, Claude CLI
- docker-compose.yml: mounts for Docker socket, git creds, Claude CLI dirs, Codex auth, all projects
- Created `gil` user (sudo, docker, passwordless sudo, SSH via Tailscale)

### LLM Tools (Phase 5)
- Installed `llm` CLI (v0.28) with `llm-openrouter` plugin — 26+ free models
- OpenRouter key configured, auto-sets on container start

### Codex CLI (Phase 6)
- Installed Codex CLI (v0.104.0) — free code review via ChatGPT account auth (NOT API)
- Codex caught 4 real bugs total across the session

### Bot Upgrades (Phase 7) — 6 features deployed
1. Media Sending via Baileys
2. Auto-Split at paragraph boundaries with (1/N) numbering
3. Express HTTP Server on port 3001 (send, github/coolify/generic webhooks)
4. Voice Transcription via Groq Whisper API (free)
5. Screenshots via puppeteer-core + Chromium
6. Multi-message combined with auto-split

### Cleanup
- Deleted stale copies, pruned old Docker images (~2.8GB)

## 2026-02-23

### SurfaBabe v1.0 — Built & Deployed
- New repo `bluemele/SurfaBabe` — stripped Overlord fork for SurfaBabe Wellness (Ailie's business)
- 16 files, 7 products with VND pricing, bilingual EN/VI
- Order state machine, silent mode default, connected to Ailie's WhatsApp Business

### Overlord Bug Fix — LID Resolution
- Fixed Gil getting Sonnet instead of Opus in group chats (LID mismatch)

### Agent Isolation & Family Profiles
- Britt (Ailie), Ai Chan (Nami), Dex (Seneca) sub-agents
- Group chat: always Overlord/Sage; personal agents only in DMs
- Power user sandboxing, /newproject workflow
- Family members added: Monet, Ayisha, Nephew, Alan

### X/Twitter Trends Skill
- Created `skills/x-trends/xtrends.py` — trends (with fallback scrapers), search, user subcommands
- twikit for auth-based access, GetDayTrends.com + Trends24.in fallbacks for trends
- File-based caching at /tmp/x_cache/
- Added twikit to Dockerfile pip install
- X_USERNAME/X_EMAIL/X_PASSWORD added to .env (empty — needs Gil's burner account)
- Registered in CLAUDE.md and REGISTRY.md

### MasterCommander Landing Page
- Dark nautical theme, interactive SVG flow diagram with animated data pulses
- Three communication tiers: On Board, Remote (WhatsApp), Master (Cloud)
- Click-to-inspect nodes, responsive design
- Commander Unit prototype code (digestion module) — alert engine, SignalK, LLM router, WhatsApp, simulator

## 2026-02-24

### AI Chan / NamiBarden Incident — Investigated & Fixed
- **Root cause:** Claude CLI credits exhausted mid-session → file edits orphaned (on disk, never committed)
- AI Chan attempted self-recovery by running `docker build` + `docker run` directly (bypassed prompt-only restrictions)
- Rogue container `namibarden-web-1` created on bridge network — Traefik never routed to it
- **Fix:** Stopped rogue container, committed orphaned changes (`eecdd43`), rebuilt Coolify container manually
- NamiBarden has NO GitHub webhook — manual deploy required via `docker compose up -d --force-recreate`
- **TODOs:** Set up Coolify webhook for NamiBarden; enforce power user restrictions at tool level

### NamiBarden Deploy Fix
- `triggerDeploy()` now hot-copies `public/` into container via `docker cp` after git push
- Dynamic container lookup via Coolify Docker labels (survives recreates)
- Codex reviewed: fixed both P2 issues (hardcoded name, misleading success on failure)

### Fail2ban Traefik Jails
- Enabled Traefik access logging (`/data/coolify/proxy/access.log`, 4xx only)
- 3 new jails: `traefik-auth` (401 brute force), `traefik-botsearch` (path scanners), `traefik-ratelimit` (excessive 4xx)
- Logrotate configured (14 days, compressed, daily)
- All filters tested and verified against real + synthetic log lines

### Morning Briefing Overhaul
- Container name resolver: maps Coolify hash names → human-readable (NamiBarden, BeastMode, Lumina, etc.)
- Uses Docker labels (`coolify.serviceName`, `coolify.projectName`) with static fallback map
- Added fail2ban stats section to briefing
- Cleaner memory format (one-line instead of raw `free -h`)
- Log monitor alerts also use friendly names now
- Schedule changed from 8am → 6am (Gil wakes ~5:30am)
- Both scheduler.js (WhatsApp) and morning-brief.sh (log file) updated
- Codex reviewed: clean, no issues

### Error Auto-Fix Protocol (saved to memory)
- Errors detected anywhere → Overlord investigates + attempts fix + codex reviews + reports outcome
- Gil never sees raw errors, only post-investigation reports

### Pushes
- SurfaBabe: Renamed bot identity from "SurfaBabe" to "Britt" (CLAUDE.md + index.js)
- Overlord: Auto-journal, deploy fix, briefing overhaul (`21707ab` → `bbf544a`, 4 commits)
- MasterCommander: Commander Unit prototype code (digestion module, 13 files)
