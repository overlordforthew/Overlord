User Accounts  
- **root**: primary workspace /root/overlord/, cron jobs, Coolify, Docker daemon  
- **gil** (UID 1000): SSH via Tailscale, passwordless sudo, Claude CLI/git credentials  
- **Cron**: health-check 6h, backup midnight, morning-brief 6am, Claude auth refresh 6h, auto-journal 11:55pm  
- **File upload**: `cb up` → SCP clipboard to /tmp/clipboard.png; `claude up folder` → SCP to /home/gil/claude-up/  

Overlord (WhatsApp AI Bot)  
- Node.js/Baileys/Claude CLI | Container: coolify network  
- Per-chat memory: /root/overlord/data/<chat_id>/memory.md  
- Session rotation: 6h auto-expire CLI sessions  
- Web chat: POST /api/web-chat → MC widget (gpt-4.1-nano)  

Lumina (Auth/Account System)  
- Coolify: okw0cwwgskcow8k8o08gsok0 | Port: 3456  
- Stack: Node.js+Express+React, PG 17, JWT | .env source of truth  

MasterCommander (AI Boat Monitor)  
- Stack: Static HTML/CSS/JS + JWT/PG/Nodemailer | nginx:alpine  
- Auth backend: Overlord server.js | PG tables (users/boats/gate_users/boat_logs)  

Stripe (NamiBarden)  
- Account: Gilbert Barden (gilbarden@gmail.com) | US  
- CLI: stripe-nb | Keys: /root/projects/NamiBarden/.env  
- Webhook: https://namibarden.com/api/stripe/webhook  

NamiBarden (Main Site + Newsletter)  
- Stack: Node.js 20+Express+nginx | PG 17 (namibarden-db)  
- DB: 6 tables | Admin: /admin/ | SMTP: overlord.gil.ai@gmail.com  

SurfaBabe (Wellness WhatsApp AI)  
- Node.js/Baileys/Claude CLI (Overlord fork) | Port: 3002  
- Models: Opus 4.6 (Ailie), Sonnet 4.6 (customers) | DB: PG 17 (surfababe-db)  

OnlyHulls (AI Boat Matchmaking)  
- Coolify: qkggs84cs88o0gww4wc80gwo | Stack: Next.js 16/PG 17  
- DB: onlyhulls (10 tables) | Status: Phase 1a (needs API keys)  

Elmo (OnlyDrafting)  
- Coolify: zkk0k8gcgcss4osggs4k0kw4 | Domain: onlydrafting.com  

Portable Agents  
- Path: /root/agents/ | Agents: AI Chan, Britt, Dex  

Coolify API  
- Token: COOLIFY_API_TOKEN in /root/overlord/.env  
- Usage: curl -H "Authorization: Bearer $COOLIFY_API_TOKEN" $API/...  

Shannon (AI Pentest Framework)  
- Path: /root/projects/shannon/ | Model: Sonnet  
- Run: `./shannon start URL=<url> REPO=<name>`
