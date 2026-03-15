# Overlord Memory Index

> Auto-generated from semantic memory DB. For deeper knowledge: `mem search <query>` or `mem recall <category>`

## Tools
- **gws**: Google Workspace CLI (gws v0.8.0) — fully authenticated as overlord.gil.ai@gmail.com. Scopes: Gmail, Calendar, Drive, Sh
- **claude-cli**: Claude CLI — Anthropic Claude Code CLI. Uses OAuth (no API key needed). Auth refresh cron every 6h. Installed globally i
- **codex-cli**: Codex CLI (codex review --commit HEAD) — free code review via ChatGPT auth (NOT API). Auth stored at /root/.codex/auth.j
- **chrome-gui**: Headful Chrome browser — systemd service chrome-gui. Access: http://100.83.80.116:6080/vnc.html (Tailscale-only, no pass
- **gh-cli**: GitHub CLI (gh) — available in container. GH_TOKEN in /root/overlord/.env for push access. For git push: git remote set-
- **docker**: Docker CLI available in Overlord container via mounted /var/run/docker.sock. Can manage all containers on the host. Use 
- **llm-cli**: llm CLI (v0.28) — universal LLM interface via OpenRouter plugin. 26+ free models: DeepSeek R1, Llama 3.3 70B, Gemma 3, Q
- **discord-mcp**: Discord MCP — bot app ID 1479963348228636894. Token in /root/.claude.json mcpServers.discord.env. Tools: list servers, r
- **veo**: Google Veo video generation (/veo skill). API key: GOOGLE_API_KEY in /root/.env, free tier with daily limits.
- **shannon**: Shannon AI Pentest Framework at /root/projects/shannon/. Run: ./shannon start URL=<url> REPO=<name>. Resume: ./shannon s
- **yt-dlp**: yt-dlp installed at /usr/local/bin/yt-dlp for downloading videos/audio from YouTube and other platforms.

## Projects
- **overlord**: WhatsApp AI Bot + Workspace at /root/overlord/. Stack: Node.js, Baileys (WhatsApp Web), Claude CLI. Runs in Docker on co
- **namibarden**: Main site + Newsletter + Course Platform at /root/projects/NamiBarden/. URL: namibarden.com. Stack: Node.js 20 + Express
- **mastercommander**: AI Boat Monitor Landing Page at /root/projects/MasterCommander/. URL: mastercommander.namibarden.com. Stack: Static HTML
- **surfababe**: SurfaBabe Wellness WhatsApp AI at /root/projects/SurfaBabe/. URL: surfababe.namibarden.com. Stack: Node.js/Baileys/Claud
- **lumina**: Auth/Account System. URL: lumina.namibarden.com. Stack: Node.js + Express + React (esbuild), PG 17, JWT. Deploy: Coolify
- **beastmode**: Web App + API at /root/projects/BeastMode/. URL: beastmode.namibarden.com. Coolify app UUID ug80oocw84scswk084kcw0ok. De
- **elmo**: OnlyDrafting at /root/projects/Elmo/. Domain: onlydrafting.com. Coolify token zkk0k8gcgcss4osggs4k0kw4. Deploy: Coolify 
- **onlyhulls**: AI Boat Matchmaking at /root/projects/OnlyHulls/. Domain: onlyhulls.com. Stack: Next.js 16, PG 17. Coolify token qkggs84
- **elsalvador**: ElSalvador Land Scout — OFFLINE. Stack: Python 3.12, FastAPI, Playwright. Coolify app ID q0wcsgo0wccsgkows08gocks. Auto-

## Infrastructure
- **server**: Hetzner CX33 — Ubuntu 24.04, 4-core AMD EPYC, 8GB RAM, 80GB SSD. IP: 89.167.12.82. Tailscale: 100.83.80.116. Coolify (co
- **traefik**: Traefik v3.6 reverse proxy. Config source of truth: /data/coolify/proxy/dynamic/namibarden.yaml. Access log: /data/cooli
- **coolify**: Coolify deployment platform at coolify.namibarden.com (Tailscale-restricted). API: curl -H "Authorization: Bearer $COOLI
- **cloudflare**: Cloudflare full API access. Zones: namibarden.com (51ea8958dc949e1793c0d31435cfa699), onlydrafting.com (5a4473673d3df140
- **tailscale**: Tailscale network (gilbarden@): Overlord 100.83.80.116, Elmoserver 100.89.16.27 (shared from elmoherrera2014@), Laptop 1
- **cron-jobs**: Root crontab: health-check (6h), backup (midnight), morning-brief (6am), Claude auth refresh (6h), auto-journal (11:55pm

## Security
- **fail2ban**: Fail2ban 4 active jails: sshd (3 retries/10min → 3h ban), traefik-auth (5/5min → 6h), traefik-botsearch (3/1min → 24h, w
- **ssh**: SSH key-only auth. Restricted to private ranges (10.0.0.0/8, 172.16.0.0/12) + Tailscale. Users: root (primary), gil (UID
- **mc-auth**: MasterCommander auth: MC_JWT_SECRET rotated. Rate limiters use req.ip. requireMcAuth rejects gate tokens. Gate OTP uses 

## Integrations
- **cloudflare-api**: Cloudflare full access: Global API Key + email auth (X-Auth-Key/X-Auth-Email) in /root/overlord/.env. Account ID: 099cbd
- **stripe**: Stripe (NamiBarden): account gilbarden@gmail.com, US. CLI: stripe-nb. Keys in /root/projects/NamiBarden/.env. Webhook: h
- **coolify-api**: Coolify API token "15|overlord-41ed95a28669181758a73dd1901ef812" in /root/overlord/.env (COOLIFY_API_TOKEN). Use http://

## Key Procedures
- **deploying overlord**: 1. cd /root/overlord
- **deploying namibarden**: 1. cd /root/projects/NamiBarden
- **deploying mastercommander**: 1. cd /root/projects/MasterCommander
- **adding new subdomain**: 1. Cloudflare wildcard handles DNS (no changes needed)
- **checking email**: 1. gws gmail users messages list --params '{"userId":"me","maxResults":10,"q":"in:inbox is:unread"}'

## Preferences
- Gil wants action, not advice. Execute first, explain after. Gil is a developer.
- Codex review is MANDATORY for all significant code changes — always run codex review --commit HEAD before final push.
- Error auto-fix protocol: When error detected, research and understand it, attempt autonomous fix, run codex review, noti
- New projects: Always init git, create GitHub repo under bluemele/, push, and set up Coolify webhook.
- Always unsubscribe from marketing/promo emails during inbox cleanup. Archive informational noise (security alerts alread
