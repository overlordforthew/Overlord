# Server Memory — Overlord

> Core config in `/root/CLAUDE.md`. Deploy rules in `.claude/rules/deploy.md`. Security in `.claude/rules/security.md`.

## User Accounts
- **root** — primary workspace at `/root/overlord/`, all cron jobs, Coolify, Docker daemon
- **gil** (UID 1000) — SSH via Tailscale, passwordless sudo, has Claude CLI + git credentials
- **Cron (root):** health-check (6h), backup (midnight), morning-brief (6am), claude auth refresh (6h), auto-journal (11:55pm)
- **File upload workflows:**
  - `cb up` → SCP clipboard to `/tmp/clipboard.png`, say `cb` in CLI
  - `claude up` folder (Windows Desktop) → SCP to `/home/gil/claude-up/`, say "check claude-up" in CLI

## Overlord — WhatsApp AI Bot
- **Path:** `/root/overlord/` | **Stack:** Node.js, Baileys, Claude CLI | **Container:** `overlord` on coolify network
- **Workspace files:** CLAUDE.md, IDENTITY.md, USER.md, MEMORY.md, BRAIN.md, INBOX.md, PLAYBOOK.md, VOICE.md, STATUS.md, CHANGELOG.md
- **Skills:** 9 instruction-only + 4 with tools (monitoring, web-scraper, api-integrations, data-analysis)
- **Scripts:** health-check.sh, backup.sh, update-status.sh, morning-brief.sh, auto-journal.sh, codex-review.sh
- **Per-chat memory:** `/root/overlord/data/<chat_id>/memory.md`
- **Bot triggers:** `['claude', 'bot', 'ai', 'hey claude', 'overlord', 'sage']`
- **Web chat:** `POST /api/web-chat` — MasterCommander widget via OpenRouter (gpt-4.1-nano)

## Lumina — Auth/Account System
- **Coolify app:** okw0cwwgskcow8k8o08gsok0 | **URL:** lumina.namibarden.com (port 3456)
- **Stack:** Node.js + Express + React (esbuild), PostgreSQL 17, JWT
- **Network:** isolated (Traefik bridges HTTP)
- **Note:** Local `/var/www/lumina/.env` is stale — Coolify `.env` is source of truth

## BeastMode — Web App + API
- **Coolify:** ug80oocw84scswk084kcw0ok (frontend) + eoc8084s8gckk4skgsg08k08 (API)
- **URL:** beastmode.namibarden.com | **DB:** `co88ksk4cks8s8o44o8gc8w8` (also hosts MC auth)

## ElSalvador — Land Scout (OFFLINE)
- OFFLINE since 2026-02-26. Container stopped, auto-deploy off. Data volume preserved.
- **Stack:** Python 3.12, FastAPI, Playwright | **Coolify:** q0wcsgo0wccsgkows08gocks

## MasterCommander — AI Boat Monitor
- **Path:** `/root/projects/MasterCommander/` | **URL:** mastercommander.namibarden.com (port 3010)
- **Stack:** Static HTML/CSS/JS + auth (JWT, PG, Nodemailer), nginx:alpine
- **Auth backend:** Overlord server.js, PostgreSQL `mc_users`/`boats` tables
- **Product:** AI boat monitor — OS images + cloud subscription. NO hardware shipping.
- **Chat widget:** `/api/web-chat` → Overlord:3001 via Traefik

## NamiBarden — Main Site
- **Coolify:** ock0wowgsgwwww8w00400k00 | **URL:** namibarden.com
- **Contact form:** Handled by Overlord — saves to DB, emails Gil, WhatsApp notification to Nami (Ai Chan)
- **Nami LID fix:** WhatsApp sends LID `84267677782098` (not `13135550002`). Both in her profile.
- **Power user restrictions are prompt-based only** — TODO: consider --disallowedTools

## SurfaBabe — Wellness WhatsApp AI
- **Path:** `/root/projects/SurfaBabe/` | **URL:** surfababe.namibarden.com (port 3002)
- **Stack:** Node.js, Baileys, Claude CLI (Overlord fork) | **Container:** `surfababe`
- **Admin:** Ailie (Gil's daughter) | **Personal:** +81 70-8418-9804 | **Business:** +84 39 264 8332
- **Email:** uptoyou.wellness@gmail.com | **Website:** surfababe.com
- **Models:** Opus 4.6 (Ailie), Sonnet 4.6 (customers) | **Mode:** `silent` until activated
- **Products:** 7 items (skincare + cleaning), VND pricing, bilingual EN/VI
- **DB:** PostgreSQL 17 (surfababe-db), 7 tables. Schema in `schema.sql`.
- **CRM commands:** /stats, /customers, /customer, /orders, /order, /paid, /note, /tag, /untag
- **Voice guide:** `knowledge/voice.md` — Britt mirrors Ailie's real customer interaction style
- **Auto-deploy:** GitHub webhook → deploy-listener.js (port 9002, systemd `surfagent-deploy.service`)

## Elmo — Easy Engineering Services
- **Path:** `/root/projects/Elmo/` | **URL:** elmo.namibarden.com
- **Stack:** Static HTML/CSS/JS, nginx:alpine + brotli (same pattern as NamiBarden)
- **Business:** Easy Engineering Services — permit drafting & ePlans coordination for Hawai'i
- **Owner:** Elmo Herrera (Philippines) | **Email:** elmoherrera2014@gmail.com | **WhatsApp:** +63 929 414 2510
- **Coolify:** zkk0k8gcgcss4osggs4k0kw4 | **Deploy:** Coolify auto-deploy on git push
- **Contact form:** mailto: to elmoherrera2014@gmail.com (client-side)
- **Created:** 2026-02-27

## Portable Agents Framework
- **Path:** `/root/agents/` (repo: bluemele/agents, private)
- **Agents:** AI Chan (Nami), Britt (Ailie), Dex (Seneca)
- **Structure:** `identity.md` + `config.json` + `memory/` per agent
- **Build:** `./build.sh claude` → generates `.claude/agents/{name}.md` + `.claude/agent-memory/{name}/`

## Security Audit History
- **2026-02-25:** Fixed sshd jail backend, `.env` perms, package updates
- **2026-02-26:** Full sweep — ElSalvador API auth, BeastMode CORS, Lumina JWT secret, SurfaBabe .env perms

## See Also
- [infrastructure.md](infrastructure.md) — container/DB/volume/network map
- [projects.md](projects.md) — detailed project notes
- [work-log.md](work-log.md) — session work logs
