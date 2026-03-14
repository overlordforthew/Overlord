root: /root/overlord/
gil (UID 1000): Tailscale SSH, passwordless sudo, Claude CLI/git creds
Cron: health-check 6h, backup midnight, morning-brief 6am, Claude auth refresh 6h, auto-journal 11:55pm
File upload: `cb up` → SCP /tmp/clipboard.png; `claude up folder` → SCP /home/gil/claude-up/
Overlord (WhatsApp AI Bot): Node.js/Baileys/Claude CLI | Container: coolify network
Per-chat memory: /root/overlord/data/<chat_id>/memory.md
Session rotation: 6h auto-expire CLI sessions
Web chat: POST /api/web-chat → MC widget (gpt-4.1-nano)
Lumina (Auth/Account System): Coolify token okw0cwwgskcow8k8o08gsok0 | Port: 3456
Stack: Node.js+Express+React, PG 17, JWT | .env source of truth
MasterCommander (AI Boat Monitor): Static HTML/CSS/JS + JWT/PG/Nodemailer | nginx:alpine
Auth backend: Overlord server.js | PG tables (users/boats/gate_users/boat_logs)
Stripe (NamiBarden): gilbarden@gmail.com | US
CLI: stripe-nb | Keys: /root/projects/NamiBarden/.env
Webhook: https://namibarden.com/api/stripe/webhook
NamiBarden (Main Site + Newsletter + Course Platform): Node.js 20+Express+nginx | PG 17 (namibarden-db)
DB: 6 tables | Admin: /admin/ | SMTP: overlord.gil.ai@gmail.com
Courses: HLS video via R2 | 2 courses | Stripe checkout + access tokens
Video pipeline: /root/scripts/video-pipeline.sh (MP4 → HLS → R2)
Key WhatsApp JIDs: Nami:84393251371@s.whatsapp.net, Gil:18587794588@s.whatsapp.net (LID:109457291874478@lid), Emiel:19195008873@s.whatsapp.net, Bot (Sage):13055601031@s.whatsapp.net, SurfaBabe bot:84392648332@s.whatsapp.net
SurfaBabe (Wellness WhatsApp AI): Node.js/Baileys/Claude CLI (Overlord fork) | Port: 3002
Models: Opus 4.6 (Ailie), Sonnet 4.6 (customers) | DB: PG 17 (surfababe-db)
OnlyHulls (AI Boat Matchmaking): Coolify token qkggs84cs88o0gww4wc80gwo | Stack: Next.js 16/PG 17
DB: onlyhulls (10 tables) | Status: Phase 1a (needs API keys)
Elmo (OnlyDrafting): Coolify token zkk0k8gcgcss4osggs4k0kw4 | Domain: onlydrafting.com
Portable Agents: /root/agents/ | Agents: AI Chan, Britt, Dex
Google Workspace CLI (gws v0.8.0): overlord.gil.ai@gmail.com | GCP project: overlord-488220
Credentials: /root/.config/gws/credentials.json (chmod 600)
Scopes: Drive, Sheets, Gmail, Calendar, Docs, Tasks
Usage: `gws gmail users messages list --params '{"userId":"me"}'`
Refresh token expires ~7 days — re-auth with `gws auth login` if needed
Authority: Overlord may use Gmail, Calendar, Drive, Sheets, Docs autonomously
Daily email check via cron (heartbeat)
Cloudflare (Full API Access): Global API Key + email auth (X-Auth-Key/X-Auth-Email)
All creds in /root/overlord/.env (CLOUDFLARE_GLOBAL_API_KEY, CLOUDFLARE_EMAIL, CLOUDFLARE_ACCOUNT_ID)
Zones: namibarden.com, onlydrafting.com, onlyhulls.com (Free plan)
R2 bucket: `namibarden-courses` (EEUR)
rclone configured: `/root/.config/rclone/rclone.conf` | Upload script: `/root/scripts/r2-upload.sh`
R2 S3 creds: R2_ACCESS_KEY + R2_SECRET_KEY in .env (secret = SHA-256 of token value)
Domains registered: namibarden (2029), onlyhulls (2029), onlydrafting (2027)
Tunnel: `elmoserver` (healthy) | NO Containers (OpenClaw killed)
Full skill docs: ~/.claude/learned/global/cloudflare-api.md
Coolify API: Token COOLIFY_API_TOKEN in /root/overlord/.env
COOLIFY_API_URL=http://localhost:8000 (also in .env — use this, NOT coolify.namibarden.com which is Tailscale-restricted)
Usage: curl -H "Authorization: Bearer $COOLIFY_API_TOKEN" http://localhost:8000/api/v1/...
Shannon (AI Pentest Framework): Path: /root/projects/shannon/ | Model: Sonnet
Run: `./shannon start URL=<url> REPO=<name>`
Resume: `./shannon start URL=<original-url> REPO=<name> WORKSPACE=<workspace-name>`
Worker: `docker compose -f docker-compose.yml -f docker-compose.docker.yml up -d worker`
Audit logs: /root/projects/shannon/audit-logs/
ALL PROJECTS AUDITED — Shannon shut down (restart when needed)
/learn Command: Extracts patterns from sessions into ~/.claude/learned/
Structure: ~/.claude/learned/{global,overlord,namibarden,...}/<pattern>.md
INDEX at ~/.claude/learned/INDEX.md — check before creating duplicates
Each instinct: problem, root cause, solution, evidence, confidence score
Project-scoped by default; promote to global when seen in 2+ projects
Discord Integration: Bot app ID 1479963348228636894 | Token in /root/.claude.json (mcpServers.discord.env) | Discrawl: /root/projects/discrawl/ (Go binary built, needs bot invited) | MCP: `mcp-discord` (npm, config in /root/.claude.json) | Tools: list servers, read/send/delete messages, search, manage channels, forums, webhooks, reactions | Available in new Claude Code sessions | Admin invite: https://discord.com/oauth2/authorize?client_id=1479963348228636894&scope=bot&permissions=8 | Minimal invite: https://discord.com/oauth2/authorize?client_id=1479963348228636894&scope=bot&permissions=66560
Overlord Security (all fixes applied 2026-03-07): MC_JWT_SECRET rotated (old secret in git dead); rate limiters use req.ip; requireMcAuth rejects gate tokens; Gate OTP uses crypto.randomInt(); Gate OTP lockout: code_attempts no reset if active; HTML injection: escapeHtml() on email user fields; AUTH-VULN-05: token_version in users, requireMcAuth checks tv, password change increments tv.
Codex CLI model: `gpt-5.2-codex` in ~/.codex/config.toml (gpt-5.4 dropped Mar 2026; gpt-4o/o4-mini not supported with ChatGPT auth)
