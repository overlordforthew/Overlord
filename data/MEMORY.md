# Overlord Memory Index

> Auto-generated from memory v2 DB. Use `mem search <query>` or `mem recall <category>` for deeper knowledge.

## Tools
- **github repository filter system**: Two-layer API key filtering system implemented: 1) Pre-filter in github-trending.js fetches first 3K of each repo's READ
- **gws CLI — Google Workspace**: Fully authenticated as overlord.gil.ai@gmail.com. Supports Gmail, Calendar, Drive, Sheets, Docs, Tasks. Credentials at ~
- **Chrome GUI + CDP**: Headful browser at http://100.83.80.116:6080/vnc.html (Tailscale-only). CDP port 9223 for programmatic control via chrom
- **Codex CLI — free code review**: codex review --commit HEAD. Free via ChatGPT auth. Run after every significant code commit (codex-review.sh). Catches re
- **llm CLI — free model access**: llm -m openrouter/openrouter/free "prompt". 26+ free models via OpenRouter. Useful for quick queries without burning Opu

## Projects
- **Project deploy methods**: BeastMode/Lumina/Elmo/OnlyHulls: Coolify auto-deploy on git push. SurfaBabe: GitHub webhook (deploy-listener.js port 900
- **Overlord — WhatsApp bot**: Node.js + Baileys at /root/overlord/. Multi-model router (Alpha/Beta/Charlie). Memory v2 SQLite backend. Scheduler with 
- **beastmode**: BeastMode is live again at `https://beastmode.namibarden.com` and deploys via Coolify on push to `main`. Do not treat disposable local verification containers like `beastmode-*test*` as production outages, stopped services, or auto-repair targets; they are temporary test containers and may be stopped or removed immediately after verification while production remains healthy.

## Infrastructure
- **Container memory limit: 2GB**: Overlord container has a 2GB memory limit. Heavy tasks cause SIGTERM/code 143. Must break up heavy operations — one majo
- **Server: Hetzner CX33**: Ubuntu 24.04, 4-core AMD EPYC, 8GB RAM, 80GB SSD. Coolify for orchestration, Traefik v3.6 reverse proxy, PostgreSQL 17, 
- **Cloudflare DNS + Traefik routing**: Cloudflare wildcard *.namibarden.com. New subdomains only need a Traefik route in /data/coolify/proxy/dynamic/namibarden
- **website multilingual structure**: Website uses separate HTML files for Japanese (e.g., consultation.html) and English versions (e.g., consultation-en.html
- **gws-oauth-lifecycle**: GWS OAuth tokens expire in 7 days when app is in Testing mode (project overlord-488220). Fix: publish app to In Producti
- **google-auth-workaround**: Google blocks OAuth sign-in from Chrome instances with --remote-debugging-port. Solution: launch a temporary Chrome WITH

## Security
- **Fail2ban: 4 active jails**: sshd (3 retries/10min, 3h ban), traefik-auth (5 retries/5min, 6h ban for 401 brute force), traefik-botsearch (3 retries/
- **SSH key-only, network bindings**: All app containers bound to 127.0.0.1 only — nothing exposed directly, all traffic via Traefik. SSH restricted to privat

## Integrations
- **Coolify API**: Tokens in personal_access_tokens table are SHA-256 hashed. Env vars updated via PATCH /api/v1/applications/{uuid}/envs. 
- **Cloudflare API**: Full access via CLOUDFLARE_GLOBAL_API_KEY in .env. Supports DNS, R2 storage, zones. Used for DNS management and CDN.
- **google-cloud-apis**: Updated 2026-03-21: Full --full auth completed. 11 OAuth scopes including cloud-platform and pubsub. 30 APIs enabled on 
- **youtube-cli**: yt CLI tool installed at /usr/local/bin/yt. Full OAuth read/write access to @namibarden YouTube channel (namiokamura@gma

## Preferences
- Action not advice. Execute first, explain after. Always use Opus (claude-opus-4-6). Minimal targeted changes. Paralleliz
- Phone: 13055601031 (WhatsApp admin). GitHub: bluemele. Domain: namibarden.com. Email: overlord.gil.ai@gmail.com. X: @ove

## Key Procedures
- **Deploy Overlord**: 1. Edit code in /root/overlord/. 2. git add + commit + push. 3. docker compose up -d --build. 4. doc
- **Git push authentication**: gh auth token lacks push scope. Use GH_TOKEN from /root/overlord/.env: git remote set-url origin "ht
- **Add new subdomain**: 1. Edit /data/coolify/proxy/dynamic/namibarden.yaml — add router + service. 2. Traefik picks up chan
- **Rotate Cloudflare API token**: Automated via /root/overlord/scripts/rotate-cf-token.sh (cron: quarterly, 1st of Jan/Apr/Jul/Oct at 

## Standing Orders & Rules
- Gil's personal email: gilbarden@gmail.com (Overlord does NOT have access)
- overlord.gil.ai@gmail.com is OVERLORD'S email, not Gil's — Overlord owns it and can use freely
- Owns a Catana 581 sailing catamaran (58ft, Christophe Barreau design)
- Home port: Chaguaramas, Trinidad
- Building "Commander" — AI boat monitor that connects marine electronics (SignalK) to WhatsApp
- Project uses Node.js, Baileys (WhatsApp), WebSocket for SignalK
- Elmo's server (onlydrafting.com): has a 6GB NVIDIA GPU — capable of LLM training runs (nanochat scale), suitable for autoresearch loop
- autoresearch (Karpathy) already running on Elmo's server
- STANDING ORDER: When Ai Chan (NamiBarden bot) escalates requests (e.g., rebuild namibarden container), Overlord should execute them autonomously witho
- STANDING ORDER (SELF-HEALING): RKHunter warnings, server errors, and other automated alerts — Overlord MUST auto-repair immediately without notifying 

## Recent Context
- Gil is interested in daily tracking of MSTR price, $180 strike LEAP pricing, and BTC correlation. (2026-03-28)
- Gil believes the MSTR market is in a downmarket, expecting recovery as early as May, but more certainly by October, poss (2026-03-28)
- Overlord has an unidentified contact WhatsApp number: 243898425299000. (2026-03-28)
- Overlord has Nami's WhatsApp number stored in its contacts. (2026-03-28)
- Overlord does not currently have Elmo's WhatsApp number. (2026-03-28)
- The strategy for creating clickable YouTube short titles involves using '〇〇' for curiosity, directly addressing the view (2026-03-28)
- User instructed to rename YouTube video #9 from '価値観が合わないときはどうすれば？(A)' to '価値観が合わないときはどうすれば？' (removing the (A) suffix)  (2026-03-27)
- Gil requested swapping the YouTube video order: moved 'セックスがうまくいかないワケ(1)' before 'セックスがうまくいかないワケ (2)' on Nami Barden's c (2026-03-27)
