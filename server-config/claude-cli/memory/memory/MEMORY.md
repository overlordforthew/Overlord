# Overlord Memory Index

> Auto-generated from semantic memory DB. For deeper knowledge: `mem search <query>` or `mem recall <category>`

## Tools
- **gws**: Google Workspace CLI (gws v0.8.0) — fully authenticated as overlord.gil.ai@gmail.com. Scopes: Gmail, Calendar, Drive, Sh
- **backup-verifier**: Backup integrity verification. Commands: check (age/size/integrity), verify (deep scan), compare (vs live DB), restore-t
- **database-admin**: Unified PostgreSQL management skill. Commands: list, health, databases, tables, sizes, schema, connections, slow, vacuum
- **security-scanner**: Automated security scanning. Commands: ports, ssl, headers, deps (npm audit), docker, fail2ban, ssh, env-files, full. Sc
- **log-analyzer**: AI-powered log analysis skill. Commands: health (scan all containers), scan, errors, traefik, diagnose (LLM root cause),
- **dns-manager**: Cloudflare DNS management. Commands: list, add, delete, update, find, check, new-site (full workflow), ssl-status, zones
- **notification-hub**: Multi-channel notifications with fallback. Commands: send, discord, email, whatsapp, test, status. Channels: WhatsApp (o
- **performance-profiler**: System performance profiling. Commands: snapshot, cpu, memory, disk, docker, network, history, headroom, report, alert. 
- **claude-cli**: Claude CLI — Anthropic Claude Code CLI. Uses OAuth (no API key needed). Auth refresh cron every 6h. Installed globally i
- **git-intelligence**: Cross-repo analysis. Commands: status (all repos), deps (npm audit), stale (old branches), activity, size, security (sec
- **codex-cli**: Codex CLI (codex review --commit HEAD) — free code review via ChatGPT auth (NOT API). Auth stored at /root/.codex/auth.j
- **calendar-manager**: Google Calendar management via gws. Commands: today, tomorrow, week, agenda, create, delete, find, free. AST timezone. S
- **email-composer**: Email composition via gws CLI. Commands: send, draft, reply, template, list-templates. Templates: marina, invoice, follo
- **chrome-gui**: Headful Chrome browser — systemd service chrome-gui. Access: http://100.83.80.116:6080/vnc.html (Tailscale-only, no pass
- **gh-cli**: GitHub CLI (gh) — available in container. GH_TOKEN in /root/overlord/.env for push access. For git push: git remote set-

## Projects
- **overlord**: WhatsApp AI Bot + Workspace at /root/overlord/. Stack: Node.js, Baileys (WhatsApp Web), Claude CLI. Runs in Docker on co
- **namibarden**: Main site + Newsletter + Course Platform at /root/projects/NamiBarden/. URL: namibarden.com. Stack: Node.js 20 + Express
- **surfababe**: SurfaBabe Wellness WhatsApp AI at /root/projects/SurfaBabe/. URL: surfababe.namibarden.com. Stack: Node.js/Baileys/Claud
- **mastercommander**: AI Boat Monitor Landing Page at /root/projects/MasterCommander/. URL: mastercommander.namibarden.com. Stack: Static HTML
- **beastmode**: Web App + API at /root/projects/BeastMode/. URL: beastmode.namibarden.com. Coolify app UUID ug80oocw84scswk084kcw0ok. De
- **lumina**: Auth/Account System. URL: lumina.namibarden.com. Stack: Node.js + Express + React (esbuild), PG 17, JWT. Deploy: Coolify
- **onlyhulls**: AI Boat Matchmaking at /root/projects/OnlyHulls/. Domain: onlyhulls.com. Stack: Next.js 16, PG 17. Coolify token qkggs84
- **elmo**: OnlyDrafting at /root/projects/Elmo/. Domain: onlydrafting.com. Coolify token zkk0k8gcgcss4osggs4k0kw4. Deploy: Coolify 
- **elsalvador**: ElSalvador Land Scout — OFFLINE. Stack: Python 3.12, FastAPI, Playwright. Coolify app ID q0wcsgo0wccsgkows08gocks. Auto-

## Infrastructure
- **server**: Hetzner CX33 — Ubuntu 24.04, 4-core AMD EPYC, 8GB RAM, 80GB SSD. IP: 89.167.12.82. Tailscale: 100.83.80.116. Coolify (co
- **traefik**: Traefik v3.6 reverse proxy. Config source of truth: /data/coolify/proxy/dynamic/namibarden.yaml. Access log: /data/cooli
- **cloudflare**: Cloudflare full API access. Zones: namibarden.com (51ea8958dc949e1793c0d31435cfa699), onlydrafting.com (5a4473673d3df140
- **coolify**: Coolify deployment platform at coolify.namibarden.com (Tailscale-restricted). API: curl -H "Authorization: Bearer $COOLI
- **tailscale**: Tailscale network (gilbarden@): Overlord 100.83.80.116, Elmoserver 100.89.16.27 (shared from elmoherrera2014@), Laptop 1
- **cron-jobs**: Root crontab: health-check (6h), backup (midnight), morning-brief (6am), Claude auth refresh (6h), auto-journal (11:55pm

## Security
- **fail2ban**: Fail2ban 4 active jails: sshd (3 retries/10min → 3h ban), traefik-auth (5/5min → 6h), traefik-botsearch (3/1min → 24h, w
- **ssh**: SSH key-only auth. Restricted to private ranges (10.0.0.0/8, 172.16.0.0/12) + Tailscale. Users: root (primary), gil (UID
- **mc-auth**: MasterCommander auth: MC_JWT_SECRET rotated. Rate limiters use req.ip. requireMcAuth rejects gate tokens. Gate OTP uses 

## Integrations
- **stripe**: Stripe (NamiBarden): account gilbarden@gmail.com, US. CLI: stripe-nb. Keys in /root/projects/NamiBarden/.env. Webhook: h
- **cloudflare-api**: Cloudflare full access: Global API Key + email auth (X-Auth-Key/X-Auth-Email) in /root/overlord/.env. Account ID: 099cbd
- **coolify-api**: Coolify API token "15|overlord-41ed95a28669181758a73dd1901ef812" in /root/overlord/.env (COOLIFY_API_TOKEN). Use http://

## Key Procedures
- **testing memory system**: 1. Run mem stats\n2. Run mem search for known items\n3. Check MEMORY.md line count\n4. Verify contai
- **deploying overlord**: 1. cd /root/overlord
- **deploying namibarden**: 1. cd /root/projects/NamiBarden
- **deploying mastercommander**: 1. cd /root/projects/MasterCommander
- **adding new subdomain**: 1. Cloudflare wildcard handles DNS (no changes needed)

## Preferences
- Gil wants action, not advice. Execute first, explain after. Gil is a developer.
- Codex review is MANDATORY for all significant code changes — always run codex review --commit HEAD before final push.
- Error auto-fix protocol: When error detected, research and understand it, attempt autonomous fix, run codex review, noti
- New projects: Always init git, create GitHub repo under bluemele/, push, and set up Coolify webhook.
- Always unsubscribe from marketing/promo emails during inbox cleanup. Archive informational noise (security alerts alread
