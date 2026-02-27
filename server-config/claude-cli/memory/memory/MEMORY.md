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
- **RAM:** 7.6 GB total (~2.2 GB used, ~5.4 GB available)
- **Disk:** 75 GB (~27 GB used / ~46 GB free)
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
- **Web chat API:** `POST /api/web-chat` — serves MasterCommander chat widget via OpenRouter (`openai/gpt-4.1-nano`), CORS for mastercommander.namibarden.com, rate limited 10/min/IP

### Lumina — Auth/Account System
- **Path:** `/var/www/lumina/` (local clone, stale), Coolify-managed at `/data/coolify/applications/okw0cwwgskcow8k8o08gsok0/`
- **Stack:** Node.js + Express + React (esbuild), PostgreSQL 17, JWT
- **URL:** lumina.namibarden.com (port 3456)
- **Coolify app ID:** okw0cwwgskcow8k8o08gsok0
- **Network:** isolated `okw0cwwgskcow8k8o08gsok0` (Traefik bridges HTTP)
- **Note:** Local `/var/www/lumina/.env` is stale — Coolify `.env` is source of truth

### BeastMode — Web App + API
- **Repo:** bluemele/BeastMode (deployed via Coolify)
- **URL:** beastmode.namibarden.com (port 3000)
- **Coolify app ID:** ug80oocw84scswk084kcw0ok (frontend), eoc8084s8gckk4skgsg08k08 (API service)
- **API:** Separate container (`api-eoc8084s8gckk4skgsg08k08`) with Express + PostgreSQL 17
- **DB:** Shared `co88ksk4cks8s8o44o8gc8w8` (beastmode-db) — also hosts MasterCommander auth DB

### ElSalvador — Land Scout (OFFLINE)
- **Status:** OFFLINE since 2026-02-26. Container stopped, restart disabled, auto-deploy off. Data volume preserved.
- **To restore:** Coolify dashboard → Start, or `docker start` container + re-enable auto-deploy in Coolify DB
- **Stack:** Python 3.12, FastAPI, Uvicorn, Playwright (Chromium), SQLAlchemy/SQLite
- **Repo:** bluemele/ElSalvador
- **URL:** elsalvador.namibarden.com (port 8000) — currently returns Traefik 404
- **Scrapers:** Encuentra24, Nexo Inmobiliario, Sophia Business, Realty El Salvador + FallbackSample
- **Coolify app ID:** q0wcsgo0wccsgkows08gocks
- **Data volume:** `elsalvador-data:/app/data` (SQLite DB) — preserved

### MasterCommander — AI Boat Monitor Landing Page
- **Path:** `/root/projects/MasterCommander/`
- **Repo:** bluemele/MasterCommander
- **URL:** mastercommander.namibarden.com (port 3010)
- **Stack:** Static HTML/CSS/JS + auth system (JWT, PostgreSQL, Nodemailer), nginx:alpine container
- **Deploy:** No Coolify webhook — use `docker cp` to hot-copy into `mastercommander` container
- **Auth:** Signup/login/password-reset + email verification + dashboard (profile, boats, password). Backend endpoints in Overlord `server.js`, JWT auth, PostgreSQL `mc_users`/`boats` tables
- **Product:** AI boat monitor — downloadable OS images + cloud subscription. NO hardware shipping.
- **Hardware tiers:** Raspberry Pi (~$280), Mac Mini M4 (~$800), Delivery Puck (~$325), Diagnostic Scanner ($75/scan or $149/mo)
- **3 communication tiers:** On Board (WiFi/BLE), Remote (Starlink→WhatsApp), Master (Cloud→Dashboard+Alerts)
- **Site:** test3.html = latest (v3). TODO: `/api/contact` endpoint, Stripe Checkout, codex review
- **78+ use cases:** Charter (28), Private (20), Marine Pros (14), Secondary (6)
- **Interactive demo:** NLP matching (60+ patterns), auto-play scenario, contextual follow-up pills
- **Chat widget:** `/api/web-chat` → Overlord:3001 via Traefik. "Contact Us" → `wa.me/13055601031`
- **Clipboard workflow:** Gil runs `cb up` → SCP to `/tmp/clipboard.png`, then says `cb` here

### NamiBarden — Main Site
- **Repo:** bluemele/NamiBarden
- **URL:** namibarden.com / www.namibarden.com
- **Coolify app ID:** ock0wowgsgwwww8w00400k00
- **Coolify container:** ock0wowgsgwwww8w00400k00-142219419516 (coolify network)
- **No GitHub webhook** — `/deploy namibarden` now hot-copies `public/` into container via `docker cp` (fixed 2026-02-24)
- **AI Chan issue (2026-02-24):** Claude CLI credits ran out mid-edit session, changes orphaned on disk. AI Chan bypassed prompt-only restrictions to run docker build, creating rogue container on bridge network. Fixed by: committing orphaned changes, rebuilding Coolify container, adding docker cp to deploy function.
- **Power user restrictions are prompt-based only** — Bash tool is unrestricted. TODO: consider --disallowedTools or Bash pattern restrictions
- **Nami LID fix (2026-02-24):** WhatsApp sends LID `84267677782098` for Nami (not `13135550002`). Both LIDs now in her profile. Without correct LID, Prompt Guard scans power users and blocks legitimate messages (Japanese text with repeated lines triggers `text_defragmented` + `repetition_detected` false positives).

### SurfaBabe — SurfaBabe Wellness WhatsApp AI
- **Path:** `/root/projects/SurfaBabe/`
- **Repo:** bluemele/SurfaBabe
- **URL:** surfababe.namibarden.com (port 3002)
- **Stack:** Node.js, Baileys (WhatsApp Web), Claude CLI (stripped Overlord fork)
- **Container:** `surfababe` on coolify network
- **Admin:** Ailie — SurfaBabe Wellness owner, Gil's daughter
- **Ailie personal:** +81 70-8418-9804 (Japan)
- **SurfaBabe business:** +84 39 264 8332 (Vietnam) — TODO: re-pair bot to this number when phone is available
- **Email:** uptoyou.wellness@gmail.com
- **Website:** surfababe.com
- **Models:** Opus 4.6 for Ailie (admin), Sonnet 4.6 for customers
- **Mode:** `silent` (listen/log only) until told to go live. Ailie can `/mode all` to activate.
- **Products:** 7 items (skincare + cleaning), VND pricing, bilingual EN/VI
- **Features:** Product catalog, order state machine, voice transcription, FAQ/policies knowledge base
- **Database:** PostgreSQL 17 (surfababe-db container), `pg` driver, 7 tables: customers, products, orders, order_items, payments, invoices, crm_interactions. Schema in `schema.sql`, pool in `db.js`. Products seeded from `products.json` on first run. Customer upsert + language detection on every DM. Orders persist to DB + JSON fallback. Transactional order writes.
- **CRM admin commands:** /stats, /customers, /customer <phone>, /orders, /order <SB-xxx>, /paid <SB-xxx> [ref], /note <phone> <text>, /tag <phone> <tag>, /untag <phone> <tag>
- **CRM logging:** Every customer inquiry logged to crm_interactions (fire-and-forget). Language auto-detected (en/vi). Payment confirmations, order completions, and notes all tracked.
- **Knowledge base:** Fully scraped from surfababe.com (Wix site) via Playwright on 2026-02-25. products.json has bilingual descriptions, correct ingredients/sizes. faq.md has 40 Q&As across 4 categories. policies.md includes Vietnam delivery guide.
- **Auto-deploy:** GitHub webhook → `surfababe.namibarden.com/webhook/deploy` → deploy-listener.js (port 9002, systemd `surfagent-deploy.service`) → git pull + docker compose rebuild
- **Webhook secret:** stored in `scripts/deploy-listener.js` + GitHub repo settings

## Network & Security
- **Firewall:** UFW active
- **Tailscale IP:** 100.83.80.116
- **SSH:** restricted to private ranges (10.0.0.0/8, 172.16.0.0/12) + Tailscale interface; key-only (`PasswordAuthentication no`, `PermitRootLogin prohibit-password`)
- **Traefik config:** `/data/coolify/proxy/dynamic/namibarden.yaml` (source of truth)
- **Traefik access log:** `/data/coolify/proxy/access.log` (4xx only, logrotated 14d)
- **Tailscale-restricted:** coolify.namibarden.com (except `/api/v1/sentinel` which has token auth), openclaw.namibarden.com
- **Public:** namibarden.com, beastmode.namibarden.com, lumina.namibarden.com, surfababe.namibarden.com, mastercommander.namibarden.com (elsalvador offline)
- **All app containers** bound to `127.0.0.1` only — nothing exposed directly to public; all traffic via Traefik
- **Fail2ban jails (4 active):**
  - `sshd` — 3 retries / 10min → 3h ban; monitors `/var/log/auth.log`, `backend = auto` (NOT systemd — Ubuntu uses `ssh.service` not `sshd.service`, journal match was broken)
  - `traefik-auth` — 5 retries / 5min → 6h ban (401 brute force)
  - `traefik-botsearch` — 3 retries / 1min → 24h ban (wp-admin, .env, .git, phpMyAdmin scanners)
  - `traefik-ratelimit` — 20 retries / 1min → 1h ban (excessive 4xx)
  - Safe IPs: localhost, Docker internal, Tailscale `100.64.0.0/10` (never banned)
  - Config: `/etc/fail2ban/jail.local`, filters: `/etc/fail2ban/filter.d/traefik-*.conf`
- **Security audit (2026-02-25):** Fixed `backend = systemd` in sshd jail (was broken — no file monitored). Fixed `.env` perms `644 → 600`. Packages updated: libdjvulibre (security), docker-compose-plugin 5.1.0, linux-libc-dev 6.8.0-101, cloud-init 25.3.
- **Security audit (2026-02-26):** Full project sweep — all issues fixed:
  - **ElSalvador** — added `X-API-Key` auth to all write endpoints (PATCH/DELETE/POST scrape/purge). Key in `API_KEY` env var via Coolify. UI gets key injected via Jinja2 `window.ES_API_KEY`. GET /listings remains public.
  - **BeastMode** — CORS default changed from `*` to `https://beastmode.namibarden.com`; added `.gitignore`
  - **Lumina** — JWT_SECRET replaced with 48-byte random secret via Coolify API + `.env` file update; container redeployed
  - **SurfaBabe `.env`** — `644 → 600`
  - **Coolify API access** — tokens in `personal_access_tokens` table are SHA-256 hashed. To create usable token: INSERT with `sha256sum` hash, use as `{id}|{raw_token}`. Env vars updated via `PATCH /api/v1/applications/{uuid}/envs`. Coolify app `.env` files live at `/data/coolify/applications/{uuid}/.env` (plaintext, source of truth for docker compose).
  - **`gh` CLI push** — `gh auth` token lacks push scope; use `GH_TOKEN` from `/root/overlord/.env` instead: `git remote set-url origin "https://bluemele:${GH_TOKEN}@github.com/bluemele/REPO.git"`

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
- **Always use Opus** — All Claude CLI spawns in Overlord must use `claude-opus-4-6`. Set via `CLAUDE_MODEL=claude-opus-4-6` in `/root/overlord/.env`. Never default to Sonnet for any user. Both the main response spawn and the triage spawn use `CONFIG.claudeModel || 'claude-opus-4-6'`.
- **Break up heavy tasks** — Large operations (full site scrapes, multi-DB creation, bulk file ops) should be done in smaller steps to avoid hitting Overlord's 2GB container memory limit. Claude CLI + heavy I/O in a single turn caused SIGTERM (code 143) crash on 2026-02-25. Do one major operation per turn, not all at once.
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
- All apps containerized, deployed from GitHub via Coolify. See [infrastructure.md](infrastructure.md) for full container/DB/volume/network map.
- **Auto-deploy webhooks:** BeastMode, Lumina (Coolify), SurfaBabe (custom deploy-listener.js + systemd). ElSalvador auto-deploy disabled.
- **NamiBarden has NO auto-deploy** — `/deploy namibarden` uses `docker cp` after git push
- **Local clones** at `/root/projects/` — 7 projects: BeastMode, ElSalvador, Lumina, MasterCommander, NamiBarden, Overlord, SurfaBabe
- Overlord mounts `/root/projects/` → `/projects/`, `/root/.claude/` credentials, `/root/.codex/` auth
- **Disaster recovery:** `server-config/` in Overlord repo, auto-synced nightly by backup.sh
- Cloudflare wildcard `*.namibarden.com` — new subdomains just need Traefik routes
- SurfaBabe deploy webhook: systemd `surfagent-deploy.service`, port 9002

## Portable Agents Framework
- **Path:** `/root/agents/` (repo: bluemele/agents, private)
- **Purpose:** LLM-agnostic agent definitions — source of truth for all agent identities, memories, configs
- **Agents:**
  - **AI Chan** — Nami's creative partner (NamiBarden, Lumina, nami-channel). Full project access.
  - **Britt** — Ailie's SurfaBabe business partner. Full SurfaBabe access. Future: autonomous customer service.
  - **Dex** — Seneca's YouTube influencer coach. Can create/build new projects.
- **Structure:** Each agent has `identity.md` (portable personality), `config.json` (metadata), `memory/` (persistent knowledge)
- **Build:** `./build.sh claude` generates Claude Code agents from portable source; future: `./build.sh openai` etc.
- **Generated files:** `/root/.claude/agents/{ai-chan,britt,dex}.md` + `/root/.claude/agent-memory/{ai-chan,britt,dex}/`
- **Portability:** Identity/memory is plain markdown — works with any LLM. Only the runner (build.sh output) is provider-specific.
- **Old Dex agent** (`dex-influencer-guide.md`) replaced by portable-built `dex.md`

## See Also
- [infrastructure.md](infrastructure.md) - Container, database, volume, network map
- [work-log.md](work-log.md) - Detailed work logs
- [projects.md](projects.md) - Detailed project inventory
