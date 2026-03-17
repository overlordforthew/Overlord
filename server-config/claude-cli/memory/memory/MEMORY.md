# Overlord Memory Index

> Auto-generated from memory v2 DB. Use `mem search <query>` or `mem recall <category>` for deeper knowledge.

## Tools
- **gws CLI — Google Workspace**: Fully authenticated as overlord.gil.ai@gmail.com. Supports Gmail, Calendar, Drive, Sheets, Docs, Tasks. Credentials at ~
- **Chrome GUI + CDP**: Headful browser at http://100.83.80.116:6080/vnc.html (Tailscale-only). CDP port 9223 for programmatic control via chrom
- **Codex CLI — free code review**: codex review --commit HEAD. Free via ChatGPT auth. Run after every significant code commit (codex-review.sh). Catches re
- **llm CLI — free model access**: llm -m openrouter/openrouter/free "prompt". 26+ free models via OpenRouter. Useful for quick queries without burning Opu

## Projects
- **Overlord — WhatsApp bot**: Node.js + Baileys at /root/overlord/. Multi-model router (Alpha/Beta/Charlie). Memory v2 SQLite backend. Scheduler with 
- **Project deploy methods**: BeastMode/Lumina/Elmo/OnlyHulls: Coolify auto-deploy on git push. SurfaBabe: GitHub webhook (deploy-listener.js port 900

## Infrastructure
- **Server: Hetzner CX33**: Ubuntu 24.04, 4-core AMD EPYC, 8GB RAM, 80GB SSD. Coolify for orchestration, Traefik v3.6 reverse proxy, PostgreSQL 17, 
- **Container memory limit: 2GB**: Overlord container has a 2GB memory limit. Heavy tasks cause SIGTERM/code 143. Must break up heavy operations — one majo
- **Cloudflare DNS + Traefik routing**: Cloudflare wildcard *.namibarden.com. New subdomains only need a Traefik route in /data/coolify/proxy/dynamic/namibarden

## Security
- **Fail2ban: 4 active jails**: sshd (3 retries/10min, 3h ban), traefik-auth (5 retries/5min, 6h ban for 401 brute force), traefik-botsearch (3 retries/
- **SSH key-only, network bindings**: All app containers bound to 127.0.0.1 only — nothing exposed directly, all traffic via Traefik. SSH restricted to privat

## Integrations
- **Coolify API**: Tokens in personal_access_tokens table are SHA-256 hashed. Env vars updated via PATCH /api/v1/applications/{uuid}/envs. 
- **Cloudflare API**: Full access via CLOUDFLARE_GLOBAL_API_KEY in .env. Supports DNS, R2 storage, zones. Used for DNS management and CDN.

## Preferences
- Action not advice. Execute first, explain after. Always use Opus (claude-opus-4-6). Minimal targeted changes. Paralleliz
- Phone: 13055601031 (WhatsApp admin). GitHub: bluemele. Domain: namibarden.com. Email: overlord.gil.ai@gmail.com. X: @ove

## Key Procedures
- **Deploy Overlord**: 1. Edit code in /root/overlord/. 2. git add + commit + push. 3. docker compose up -d --build. 4. doc
- **Git push authentication**: gh auth token lacks push scope. Use GH_TOKEN from /root/overlord/.env: git remote set-url origin "ht
- **Add new subdomain**: 1. Edit /data/coolify/proxy/dynamic/namibarden.yaml — add router + service. 2. Traefik picks up chan
- **Rotate Cloudflare API token**: Automated via /root/overlord/scripts/rotate-cf-token.sh (cron: quarterly, 1st of Jan/Apr/Jul/Oct at 
