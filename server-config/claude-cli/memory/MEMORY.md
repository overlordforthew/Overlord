# Server Memory — Overlord

## Owner
- **Name:** Gil
- **Phone:** 13055601031 (WhatsApp admin)
- **Domain:** namibarden.com
- **GitHub:** bluemele
- **Overlord Email:** overlord.gil.ai@gmail.com
- **Overlord X/Twitter:** @overlordforthew
- **Waking hours:** ~5:30am to ~9:00pm (local time)

## Server Info
- **Hostname:** Overlord
- **Provider:** Hetzner
- **OS:** Ubuntu 24.04.4 LTS (Noble Numbat)
- **CPU:** 4-core AMD EPYC-Rome (no hyperthreading)
- **RAM:** 7.6 GB total (~2 GB used, ~5.6 GB available after cleanup)
- **Disk:** 75 GB (~20 GB used / ~55 GB free)
- **Swap:** 8 GB (barely used)
- **Orchestration:** Coolify (coolify.namibarden.com)
- **Proxy:** Traefik v3.6 (HTTPS/Let's Encrypt)
- **Databases:** PostgreSQL 17 (multiple instances), Redis 7

## User Accounts
- **root** — primary workspace at `/root/overlord/`, all cron jobs, Coolify, Docker daemon
- **gil** (UID 1000) — secondary user for SSH access
  - Groups: sudo, docker
  - SSH via Tailscale (`ssh gil@100.83.80.116`)
  - **No password, passwordless sudo** (`/etc/sudoers.d/gil`)
  - Has Claude CLI + git credentials copied from root
  - `/home/gil/overlord/` is a stale backup copy — `/root/overlord/` is source of truth
- **Cron jobs (root):** health-check + status update (6h), backup (midnight), morning-brief (6am), claude auth refresh (6h), auto-journal (11:55pm)

## Projects

### Overlord — WhatsApp AI Bot + Workspace
- **Path:** `/root/overlord/` (canonical location)
- **Stack:** Node.js, Baileys (WhatsApp Web), Claude CLI
- **Runs in:** Docker container on Coolify network
- **Workspace:** Full OVERLORD system — CLAUDE.md, IDENTITY.md, USER.md, MEMORY.md, BRAIN.md, INBOX.md, PLAYBOOK.md, VOICE.md, STATUS.md, CHANGELOG.md
- **Skills:** 9 instruction-only + 4 with executable tools (monitoring, web-scraper, api-integrations, data-analysis)
- **Scripts:** health-check.sh, backup.sh, update-status.sh, morning-brief.sh, auto-journal.sh, codex-review.sh
- **Morning briefing:** 6am via scheduler.js (WhatsApp) + cron (log file). Human-readable container names (resolves Coolify hashes via Docker labels), fail2ban stats, clean memory format
- **Container name resolver:** `resolveContainerName()` in scheduler.js — static map for known containers + dynamic lookup via `coolify.serviceName`/`coolify.projectName` Docker labels
- **Per-chat memory:** `/root/overlord/data/<chat_id>/memory.md`
- **Admin:** Gil (full shell + Docker + Git access from WhatsApp); others = chat only
- **Docker features:** Docker CLI, GitHub CLI (`gh`), Git push, Codex CLI, `llm` CLI, traefik-watcher
- **Bot trigger words:** `['claude', 'bot', 'ai', 'hey claude', 'overlord', 'sage']`

### Lumina — Auth/Account System
- **Path:** `/var/www/lumina/`
- **Stack:** Node.js + Express + React (esbuild), PostgreSQL, JWT
- **URL:** lumina.namibarden.com (port 3456)

### BeastMode — Web App + API
- **Repo:** bluemele/BeastMode (deployed via Coolify)
- **URL:** beastmode.namibarden.com (port 3000)
- **API:** Separate container with Express + PostgreSQL

### ElSalvador — Land Scout
- **Stack:** Python 3.12, FastAPI, Uvicorn, Playwright (Chromium), SQLAlchemy/SQLite
- **Repo:** bluemele/ElSalvador
- **URL:** elsalvador.namibarden.com (port 8000)
- **Scrapers:** Encuentra24, Nexo Inmobiliario, Sophia Business, Realty El Salvador + FallbackSample
- **Coolify app ID:** q0wcsgo0wccsgkows08gocks
- **Data volume:** `elsalvador-data:/app/data` (SQLite DB)

### MasterCommander — AI Boat Monitor Landing Page
- **Path:** `/root/projects/MasterCommander/`
- **Repo:** bluemele/MasterCommander
- **URL:** mastercommander.namibarden.com (port 3010)
- **Stack:** Static HTML/CSS/JS, nginx:alpine container
- **Product:** AI boat monitor for private yachts — Commander Unit (on-boat hardware) + optional Master cloud subscription
- **Architecture:** Three communication tiers:
  1. ON BOARD: Commander → Boat WiFi/BLE → Commander App (no internet)
  2. REMOTE: Commander → Starlink/WiFi → WhatsApp (Commander only, no subscription)
  3. MASTER: Starlink → Master Cloud → Push Alerts + Web Dashboard (subscription)
- **Flow diagram:** Interactive SVG with animated data pulses, click-to-inspect nodes
- **Key decisions:** SignalK stays in architecture but is "included" not customer-installed; WhatsApp works without Master; Commander App for on-board access; cameras/FLIR/security included

### NamiBarden — Main Site
- **Repo:** bluemele/NamiBarden
- **URL:** namibarden.com / www.namibarden.com
- **Coolify app ID:** ock0wowgsgwwww8w00400k00
- **Coolify container:** ock0wowgsgwwww8w00400k00-142219419516 (coolify network)
- **No GitHub webhook** — `/deploy namibarden` now hot-copies `public/` into container via `docker cp` (fixed 2026-02-24)
- **AI Chan issue (2026-02-24):** Claude CLI credits ran out mid-edit session, changes orphaned on disk. AI Chan bypassed prompt-only restrictions to run docker build, creating rogue container on bridge network. Fixed by: committing orphaned changes, rebuilding Coolify container, adding docker cp to deploy function.
- **Power user restrictions are prompt-based only** — Bash tool is unrestricted. TODO: consider --disallowedTools or Bash pattern restrictions

### SurfaBabe — SurfaBabe Wellness WhatsApp AI
- **Path:** `/root/projects/SurfaBabe/`
- **Repo:** bluemele/SurfaBabe
- **URL:** surfababe.namibarden.com (port 3002)
- **Stack:** Node.js, Baileys (WhatsApp Web), Claude CLI (stripped Overlord fork)
- **Container:** `surfagent` on coolify network
- **Admin:** Ailie (+81 70-8418-9804) — SurfaBabe Wellness owner, Gil's daughter
- **Email:** uptoyou.wellness@gmail.com
- **Website:** surfababe.com
- **Models:** Opus 4.6 for Ailie (admin), Sonnet 4.6 for customers
- **Mode:** `silent` (listen/log only) until told to go live. Ailie can `/mode all` to activate.
- **Products:** 7 items (skincare + cleaning), VND pricing, bilingual EN/VI
- **Features:** Product catalog, order state machine, voice transcription, FAQ/policies knowledge base
- **Auto-deploy:** GitHub webhook → `surfababe.namibarden.com/webhook/deploy` → deploy-listener.js (port 9002, systemd `surfagent-deploy.service`) → git pull + docker compose rebuild
- **Webhook secret:** stored in `scripts/deploy-listener.js` + GitHub repo settings
- **Phase 2 ideas:** PostgreSQL database, HubSpot CRM sync, SOHO Books-style invoicing

### OpenClaw — Multi-Channel AI Gateway (STOPPED)
- **Path:** `/opt/openclaw/`
- **Status:** Container stopped on 2026-02-21 to save ~550 MB RAM. Replaced by Overlord.

## Network & Security
- **Firewall:** UFW active
- **Tailscale IP:** 100.83.80.116
- **SSH:** restricted to private ranges (10.0.0.0/8, 172.16.0.0/12)
- **Traefik config:** `/data/coolify/proxy/dynamic/namibarden.yaml` (source of truth)
- **Traefik access log:** `/data/coolify/proxy/access.log` (4xx only, logrotated 14d)
- **Tailscale-restricted:** coolify.namibarden.com (except `/api/v1/sentinel` which has token auth), openclaw.namibarden.com
- **Public:** namibarden.com, beastmode.namibarden.com, lumina.namibarden.com, elsalvador.namibarden.com, surfababe.namibarden.com, mastercommander.namibarden.com
- **Fail2ban jails (4 active):**
  - `sshd` — 3 retries / 10min → 3h ban
  - `traefik-auth` — 5 retries / 5min → 6h ban (401 brute force)
  - `traefik-botsearch` — 3 retries / 1min → 24h ban (wp-admin, .env, .git, phpMyAdmin scanners)
  - `traefik-ratelimit` — 20 retries / 1min → 1h ban (excessive 4xx)
  - Safe IPs: localhost, Docker internal, Tailscale (never banned)
  - Config: `/etc/fail2ban/jail.local`, filters: `/etc/fail2ban/filter.d/traefik-*.conf`

## Skills & Integrations
- **`/veo`** — Google Veo video generation at `/root/.claude/skills/veo/`
  - API key: GOOGLE_API_KEY in `/root/.env`, free tier with daily limits
- **Codex CLI** (v0.104.0) — free code review via ChatGPT auth (NOT API)
  - Auth stored at `/root/.codex/auth.json`, mounted into container
  - `codex review --commit HEAD` after significant code changes
  - Auto-review script: `scripts/codex-review.sh`
- **`llm` CLI** (v0.28) — universal LLM interface via OpenRouter plugin
  - 26+ free models: DeepSeek R1, Llama 3.3 70B, Gemma 3, Qwen3, etc.
  - Best default: `llm -m openrouter/openrouter/free "prompt"` (auto-picks best available)
  - OpenRouter key auto-configured on container start from OPENROUTER_KEY env var

## API Keys (in `/root/overlord/.env`)
- **OPENROUTER_KEY** — active, used for `llm` CLI free models
- **GOOGLE_API_KEY** — active, used for Veo video generation
- **GH_TOKEN** — active, used for `gh` CLI GitHub operations
- **GROQ_API_KEY** — active, used for free Whisper voice transcription
- **WEBHOOK_TOKEN** — active, authenticates HTTP API requests
- **OPENAI_API_KEY** — COMMENTED OUT in .env, do NOT use unless Gil explicitly requests
- **ANTHROPIC_API_KEY** — DELETED (was depleted, Claude CLI uses OAuth instead)

## Preferences
- Save to memory every ~10 tool calls or after significant work
- **New projects:** Always init git, create GitHub repo under `bluemele/`, push, and set up Coolify webhook
- **YOLO mode:** All tools pre-approved in settings.local.json — no permission prompts
- Gil wants action, not advice — execute first, explain after
- **Codex review is MANDATORY** for all significant code changes — always run `codex review --commit HEAD` before final push
- **Error auto-fix protocol:** When an error is detected or forwarded via WhatsApp:
  1. Research and understand the error (read logs, trace the code, identify root cause)
  2. Attempt to fix it autonomously
  3. Run `codex review --commit HEAD` on the fix
  4. Notify Gil on WhatsApp with the outcome:
     - If fixed: explain what was wrong and what you did
     - If not fixed: explain what you found and discuss next steps
  - NEVER send raw errors to Gil — always investigate and attempt fix first
  - Gil only sees the outcome report, never the original error dump

## Architecture Notes
- All apps containerized, deployed from GitHub via Coolify
- **GitHub webhooks** auto-deploy on push: BeastMode, Lumina, ElSalvador (via Coolify), SurfaBabe (via custom deploy-listener.js + systemd)
- **NamiBarden has NO auto-deploy webhook** — `/deploy namibarden` uses `docker cp` to hot-copy static files after git push. Full rebuild still requires manual `docker compose up -d --force-recreate` in `/data/coolify/applications/ock0wowgsgwwww8w00400k00/`
- **Local clones** at `/root/projects/`
- Overlord mounts `/root/projects/` into container at `/projects/`
- Overlord mounts `/root/.claude/` credentials + `/root/.codex/` auth into container
- `/home/gil/overlord/` DELETED (was stale backup)
- `/opt/openclaw/` DELETED (was stopped, replaced by Overlord)
- HTTP API on port 3001 (localhost only, bearer token auth)
- SurfaBabe deploy webhook: systemd `surfagent-deploy.service`, port 9002, UFW restricted to 10.0.0.0/8
- Cloudflare has wildcard `*.namibarden.com` — new subdomains just need Traefik routes, no DNS changes
- If Coolify regenerates `coolify.yaml`, re-check that it doesn't re-add unprotected routes

## Work Logs
See [work-log.md](work-log.md) for detailed session logs.

**Key dates:**
- 2026-02-22: Full workspace build (phases 1-7), bot upgrades, cleanup
- 2026-02-23: SurfaBabe v1.0, LID fix, agent isolation, family profiles, X Trends skill
- 2026-02-24: MasterCommander landing page, AI Chan incident fix, NamiBarden deploy fix (docker cp), Coolify sentinel Traefik route, fail2ban Traefik jails, morning briefing overhaul (friendly names, fail2ban stats, 6am schedule)

## See Also
- [work-log.md](work-log.md) - Detailed work logs
- [projects.md](projects.md) - Detailed project inventory
