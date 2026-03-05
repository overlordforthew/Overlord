# Project Deep Notes

## Overlord
- Main code: `index.js`
- Config: `CLAUDE.md`, `.env`
- Dependencies: @whiskeysockets/baileys, pino, qrcode-terminal
- Session rotation: 6-hour auto-expire
- Stale session retry: auto-clears session_id on CLI errors, retries fresh
- Router modes: alpha (Opus), beta (Anthropic), charlie (all models)
- Session guard: kills zombie Claude processes >10min
- Heartbeat: 2hr health checks, 3 failures → auto-restart, 5 → alert Gil

## NamiBarden
- nginx proxies `/api/` → Express (port 3100)
- Contact form → DB + email Gil + WhatsApp via Overlord `/api/send`
- Newsletter: campaign composer with open/click tracking, unsubscribe
- SMTP: Gmail app password (overlord.gil.ai@gmail.com)

## SurfaBabe
- Fork of Overlord – separate codebase/container/DB
- Voice guide: `knowledge/voice.md` (Britt mirrors Ailie)
- Products: 7 items (skincare + cleaning), VND pricing, bilingual EN/VI
- Auto-deploy: GitHub webhook → `deploy-listener.js` (port 9002, systemd `surfagent-deploy.service`)

## OnlyHulls
- Auth: `auth.config.ts` (edge-safe) + `auth.ts` (bcrypt/pg)
- Build: lazy init for all lib modules
- Lockfile: npm 10 (node:20-alpine), npm 11 breaks it
- Spec: `/home/gil/claude-up/DATEMYBOAT-SPEC-v2.md`
- Coolify env vars: 14 (AUTH_URL, APP_URL, RESEND_FROM_EMAIL, DATABASE_URL, etc.)

## MasterCommander
- Auth: Overlord's `server.js`
- DB: `mastercommander-db` container, tables: `users`, `boats`, `boat_logs`, `gate_users`, `gate_nda`, `contact_submissions`, `newsletter_subscribers`
- Chat widget: Overlord `/api/web-chat` via Traefik
- Deploy: `docker cp`

## OpenClaw
- Multi-channel AI gateway, installed at `/opt/openclaw/` (stopped)
