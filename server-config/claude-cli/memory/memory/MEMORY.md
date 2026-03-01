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

## NamiBarden — Main Site + Newsletter
- **Path:** `/root/projects/NamiBarden/` | **URL:** namibarden.com
- **Stack:** Node.js 20 + Express + nginx (multi-process), PostgreSQL 17 (namibarden-db)
- **Container:** `namibarden` (standalone docker-compose, NOT Coolify-managed)
- **DB:** `namibarden-db` container, 6 tables (nb_admin, nb_subscribers, nb_contacts, nb_campaigns, nb_campaign_recipients, nb_email_events)
- **API:** Express on port 3100 (proxied by nginx `/api/`)
- **Admin:** `/admin/` dashboard — login, subscribers, compose, campaigns. Password: in `.env`
- **Contact form:** Self-contained — saves to nb_contacts, emails Gil, WhatsApp via Overlord `/api/send`
- **Newsletter:** Subscribe (PDF download + contact form), campaign composer, open/click tracking, unsubscribe
- **Deploy:** `cd /root/projects/NamiBarden && docker compose up -d --build`
- **Traefik:** Labels in docker-compose (no file-based route needed). Removed old `https-namibarden-contact` from namibarden.yaml
- **Nami LID fix:** WhatsApp sends LID `84267677782098` (not `13135550002`). Both in her profile.
- **SMTP:** Gmail app password (reuses Overlord's overlord.gil.ai@gmail.com credentials)

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

## OnlyHulls — AI Boat Matchmaking (formerly DateMyBoat)
- **Path:** `/root/projects/OnlyHulls/` | **URL:** onlyhulls.com | **Repo:** bluemele/OnlyHulls
- **Coolify:** qkggs84cs88o0gww4wc80gwo | **Deploy:** Coolify auto-deploy on git push
- **Stack:** Next.js 16 (App Router, TS, Tailwind), PG 17 + pgvector, Meilisearch, Redis, Auth.js v5 (email/password), Stripe, Claude Sonnet 4.6, OpenAI embeddings, Resend, Hetzner S3
- **Auth:** Auth.js v5 Credentials provider, bcrypt passwords, JWT sessions. Split config: `auth.config.ts` (edge-safe) + `auth.ts` (full with bcrypt/pg)
- **Infra:** `infra/docker-compose.infra.yml` — onlyhulls-db (5433), onlyhulls-meilisearch (7701), onlyhulls-redis (6380). Volumes kept as `datemyboat-*` for data continuity.
- **DB:** Database renamed to `onlyhulls`, PG user still `datemyboat` (can't rename while connected). 10 tables.
- **Seed:** 30 sample boats seeded, migrations complete through 006
- **Status:** Phase 1a code complete, deployed, Auth.js working. Needs real API keys (Stripe, Anthropic, OpenAI, Resend, S3)
- **Coolify env vars:** 14 vars configured via API (AUTH_URL=onlyhulls.com, NEXT_PUBLIC_APP_URL=onlyhulls.com, RESEND_FROM_EMAIL=OnlyHulls, DATABASE_URL points to onlyhulls-db/onlyhulls)
- **Build note:** All lib modules use lazy init (`getStripe()`, `getMeili()`, `getResend()`, etc.) to avoid build-time crashes. Lockfile must be generated with npm 10 (node:20-alpine) not npm 11
- **Traefik:** File-based route in namibarden.yaml for onlyhulls.com + www redirect
- **Spec:** `/home/gil/claude-up/DATEMYBOAT-SPEC-v2.md`

## Elmo — Elite Engineering Services (OnlyDrafting)
- **Path:** `/root/projects/Elmo/` | **URL:** onlydrafting.com (www redirects to root)
- **Stack:** Static HTML/CSS/JS, nginx:alpine + brotli (same pattern as NamiBarden)
- **Business:** Elite Engineering Services — permit drafting & ePlans coordination for Hawai'i
- **Owner:** Elmo Herrera (Philippines) | **Email:** elmoherrera2014@gmail.com | **WhatsApp:** +63 929 414 2510
- **Coolify:** zkk0k8gcgcss4osggs4k0kw4 | **Deploy:** Coolify auto-deploy on git push
- **Domain:** onlydrafting.com on Cloudflare (zone 5a4473673d3df140fa184e36f8567031), A record + www CNAME (proxied)
- **Old URL:** elmo.namibarden.com — removed from Coolify FQDN and nginx, no longer routed
- **Contact form:** mailto: to elmoherrera2014@gmail.com (client-side)
- **Created:** 2026-02-27

## Portable Agents Framework
- **Path:** `/root/agents/` (repo: bluemele/agents, private)
- **Agents:** AI Chan (Nami), Britt (Ailie), Dex (Seneca)
- **Structure:** `identity.md` + `config.json` + `memory/` per agent
- **Build:** `./build.sh claude` → generates `.claude/agents/{name}.md` + `.claude/agent-memory/{name}/`

## Coolify API
- **Token:** `COOLIFY_API_TOKEN` in `/root/overlord/.env` (Sanctum token ID 13)
- **Endpoint:** `http://127.0.0.1:8000/api/v1`
- **Usage:** `curl -H "Authorization: Bearer $COOLIFY_API_TOKEN" -H "Accept: application/json" $API/...`
- **Env vars:** `POST .../applications/{uuid}/envs` (encrypts properly, persists across deploys)
- **Redeploy:** `POST .../applications/{uuid}/restart`
- **IMPORTANT:** Never insert raw values into `environment_variables` DB table — Coolify expects encrypted values. Always use the API.

## Coolify Env Var Status
| App | UUID | Vars in Coolify | Notes |
|-----|------|-----------------|-------|
| OnlyHulls | qkggs84cs88o0gww4wc80gwo | 14 | Rebranded. AUTH_URL/APP_URL=onlyhulls.com, DB=onlyhulls |
| BeastMode | ug80oocw84scswk084kcw0ok | 5 | DATABASE_URL, JWT_SECRET, PORT, CORS_ORIGIN, VAPID_SUBJECT |
| Lumina | okw0cwwgskcow8k8o08gsok0 | 9 | Fully configured (DB_*, JWT, PORT, SERVICE_*) |
| Elmo | zkk0k8gcgcss4osggs4k0kw4 | 0 | Static site, none needed |
| ElSalvador | q0wcsgo0wccsgkows08gocks | 1 | API_KEY only (OFFLINE) |

## Cloudflare API
- **Token:** `CLOUDFLARE_API_TOKEN` in `/root/overlord/.env`
- **Account ID:** `099cbdaaadc71eef10329f795a4e564f` (Gilbarden@gmail.com)
- **Permissions:** Zone DNS Edit, Zone Settings Edit, SSL Edit, Page Rules Edit, Zone Read, Analytics Read — All zones
- **Verify:** `curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/tokens/verify" -H "Authorization: Bearer $TOKEN"`
- **Zones managed:** namibarden.com, onlydrafting.com, onlyhulls.com
- **Detailed reference:** [cloudflare.md](cloudflare.md)

## Security Audit History
- **2026-02-25:** Fixed sshd jail backend, `.env` perms, package updates
- **2026-02-26:** Full sweep — ElSalvador API auth, BeastMode CORS, Lumina JWT secret, SurfaBabe .env perms
- **2026-02-28:** Coolify API token created, env vars added via API for all Coolify-managed apps

## See Also
- [infrastructure.md](infrastructure.md) — container/DB/volume/network map
- [projects.md](projects.md) — detailed project notes
- [work-log.md](work-log.md) — session work logs
