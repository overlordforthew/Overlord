# Detailed Project Notes

## Overlord (WhatsApp Bot)
- Main code: `/root/overlord/index.js` (37KB)
- Config: `/root/overlord/CLAUDE.md`, `/root/overlord/.env`
- Docker: `/root/overlord/docker-compose.yml`
- Dependencies: @whiskeysockets/baileys, pino, qrcode-terminal, node-cache, @hapi/boom
- Features: multi-media support (images, video, audio, PDFs, stickers, contacts, location, polls), smart response triage, message batching, per-chat memory, session continuity
- Security: admin (Gil) gets shell access, everyone else is chat-only

## Lumina
- Backend: `/var/www/lumina/server.js`
- Frontend: `/var/www/lumina/src/app.jsx` (175KB React SPA)
- Auth: JWT + bcryptjs password hashing
- DB: PostgreSQL (lumina_pgdata volume)
- Features: signup/login, multi-language (i18n)

## BeastMode
- Deployed from GitHub bluemele/BeastMode via Coolify
- Separate API service at `/data/coolify/apps/beastmode-api/server.js`
- Endpoints: GET / (status), GET /health (db check)

## ElSalvador
- Python FastAPI on Uvicorn
- Data volume: elsalvador-data:/app/data
- DB: Dedicated PostgreSQL instance

## NamiBarden
- Static/content site on root domain
- Deployed via Coolify from bluemele/NamiBarden

## Elmo (Easy Engineering Services)
- Static single-page site at elmo.namibarden.com
- Business: permit drafting & ePlans coordination for Hawai'i (Elmo Herrera)
- Stack: nginx:alpine + brotli (same Dockerfile pattern as NamiBarden)
- Contact: mailto: form to elmoherrera2014@gmail.com + WhatsApp float (+63 929 414 2510)
- Deployed via Coolify from bluemele/Elmo (auto-deploy on push)

## OpenClaw
- Multi-channel AI gateway (WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, BlueBubbles, iMessage, Teams, Matrix, Zalo)
- Extensions dir for channel integrations, skills dir for capabilities
- Has macOS/iOS/Android companion apps
- Connected to YouTube API, OpenAI API, Anthropic API

## Infrastructure
- Coolify manages all deployments
- Traefik v3.6 handles reverse proxy + SSL
- Multiple PostgreSQL 17 instances
- Redis 7 for caching
- Soketi for WebSocket (Coolify realtime)
- Sentinel for health monitoring
- Fail2ban for SSH protection
