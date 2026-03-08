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
- Resume workspace: `./shannon start URL=<original-url> REPO=<name> WORKSPACE=<workspace-name>`
- Worker: `docker compose -f docker-compose.yml -f docker-compose.docker.yml up -d worker`
- Audit logs: /root/projects/shannon/audit-logs/
- ALL PROJECTS AUDITED — Shannon is shut down (restart when needed)
- Runs completed: Lumina, MasterCommander, NamiBarden, OnlyDrafting (Elmo), OnlyHulls, Overlord

/learn Command (Instinct System)
- `/learn` — extracts reusable patterns from sessions into ~/.claude/learned/
- Structure: ~/.claude/learned/{global,overlord,namibarden,...}/<pattern>.md
- INDEX at ~/.claude/learned/INDEX.md — check before creating duplicates
- Each instinct: problem, root cause, solution, evidence, confidence score
- Project-scoped by default; promote to global when seen in 2+ projects

Discord Integration
- Bot app ID: 1479963348228636894 | Token in /root/.claude.json (mcpServers.discord.env)
- Discrawl: /root/projects/discrawl/ | Go binary built | Needs bot invited to servers first
- Discord MCP: `mcp-discord` installed globally (npm) | Config in /root/.claude.json
  - Tools: list servers, read/send/delete messages, search, manage channels, forums, webhooks, reactions
  - Available in new Claude Code sessions (loads at startup)
- Bot invite (admin): https://discord.com/oauth2/authorize?client_id=1479963348228636894&scope=bot&permissions=8
- Bot invite (minimal): https://discord.com/oauth2/authorize?client_id=1479963348228636894&scope=bot&permissions=66560
- Status: Bot token works, MCP configured. Bot not yet invited to any servers.

Overlord Security (all fixes applied 2026-03-07)
- MC_JWT_SECRET rotated — old secret was committed to git and is now dead
- Rate limiters fixed: all now use req.ip (not attacker-controlled X-Forwarded-For)
- Gate JWT type confusion fixed: requireMcAuth rejects tokens with type='gate'
- Gate OTP now uses crypto.randomInt() instead of Math.random()
- Gate OTP lockout bypass fixed: code_attempts no longer resets if code still active
- HTML injection fixed: escapeHtml() applied to all user fields in outgoing emails
- AUTH-VULN-05 fixed: token_version column in users table; requireMcAuth verifies tv claim; password change increments token_version (invalidates old JWTs immediately)
