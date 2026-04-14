# Skill Registry

Quick reference of all available skills and their tools. Read the SKILL.md in each directory for full details.

## Skills with Executable Tools

| Skill | Directory | Tools | Description |
|-------|-----------|-------|-------------|
| **Monitoring** | `skills/monitoring/` | `service-check.sh`, `ssl-check.sh`, `disk-alert.sh` | Server health, container status, SSL certs, resource alerts |
| **Web Scraper** | `skills/web-scraper/` | `scrape.py`, `rss.py`, `search-scrape.py` | Extract data from any URL, read RSS feeds, search the web |
| **Scrapling** | `skills/scrapling/` | `scrape-stealth.py` | Stealth scraping with anti-bot bypass (Cloudflare, Turnstile) via TLS fingerprinting |
| **API Integrations** | `skills/api-integrations/` | `crypto.py`, `weather.py`, `news.py`, `exchange.py` | Live crypto prices, weather, news headlines, currency conversion |
| **Data Analysis** | `skills/data-analysis/` | `analyze.py`, `chart.py` | Process CSV/JSON, statistics, filtering, chart generation |
| **X Trends** | `skills/x-trends/` | `xtrends.py` | X/Twitter trending topics, tweet search, user profiles |
| **Database Admin** | `skills/database-admin/` | `db-admin.sh` | Unified PostgreSQL management — health, sizes, queries, backups, slow query analysis |
| **Log Analyzer** | `skills/log-analyzer/` | `log-analyzer.sh` | AI-powered log analysis — error detection, pattern matching, LLM diagnosis |
| **Email Composer** | `skills/email-composer/` | `email-compose.sh` | Draft and send emails via gws CLI with templates |
| **Backup Verifier** | `skills/backup-verifier/` | `backup-verify.sh` | Verify backup integrity, compare against live DBs, test restores |
| **Security Scanner** | `skills/security-scanner/` | `security-scan.sh` | Port scan, SSL check, HTTP headers, npm audit, Docker security, fail2ban |
| **DNS Manager** | `skills/dns-manager/` | `dns-manager.sh` | Cloudflare DNS management — add/remove records, new site setup, SSL status |
| **Git Intelligence** | `skills/git-intelligence/` | `git-intel.sh` | Cross-repo analysis — status, deps, stale branches, security, PRs |
| **Calendar Manager** | `skills/calendar-manager/` | `calendar.sh` | Google Calendar via gws — agenda, create events, free time |
| **Performance Profiler** | `skills/performance-profiler/` | `perf-profile.sh` | System profiling — CPU, memory, disk, Docker stats, capacity planning |
| **Notification Hub** | `skills/notification-hub/` | `notify.sh` | Multi-channel notifications — WhatsApp, Discord, email with fallback |
| **Document Reader** | `skills/document-reader/` | `doc-reader.py` | Parse PDFs, XLSX, CSV, DOCX with AI summarization |
| **Image Generator** | `skills/image-generator/` | `image-gen.sh` | AI image generation via Pollinations.ai — styles, social media sizes |
| **Skill Harvester** | `skills/skill-harvester/` | `harvest.sh`, `repo-analyzer.sh`, `skill-extract.sh` | Auto-extract skills from GitHub repos — clone, analyze, generate SKILL.md drafts |

## Skills with Instructions Only

| Skill | Directory | Description |
|-------|-----------|-------------|
| **Prompt Composer** | `skills/prompt-composer/` | Compose complex prompts from reusable blocks — div/span/vif/vChoice/ul (from AIRI, 34k stars) |
| **Action Normalizer** | `skills/action-normalizer/` | Normalize LLM JSON actions — alias maps, parameter flattening, field normalization (from AIRI) |
| **Code Review** | `skills/code-review/` | Structured reviews with priority markers (BLOCKER/SUGGESTION/NIT/PRAISE), security focus |
| **Incident Response** | `skills/incident-response/` | Severity classification, self-healing escalation, post-mortem templates, runbooks |
| **Agent Cognitive Architecture** | `skills/agent-cognitive-architecture/` | 3-layer brain patterns, action registry, context management, attention handler (from AIRI, 34k stars) |
| **Agent Event Loop** | `skills/agent-event-loop/` | Safe agentic loops — queue/schedule/dispatch with iteration caps, abort control, context trimming (from AIRI) |
| **Server Admin** | `skills/server-admin/` | Docker, Coolify, UFW, Tailscale, backups, security procedures |
| **WhatsApp** | `skills/whatsapp/` | Chat behavior, group rules, admin commands, media handling |
| **Video Pipeline** | `skills/video-pipeline/` | Nami's meditation videos: script → voice → visuals → publish |
| **Web Dev** | `skills/web-dev/` | Full-stack dev → GitHub push → Coolify auto-deploy |
| **Mobile Dev** | `skills/mobile-dev/` | Capacitor wrapping for Android/iOS |
| **Trading** | `skills/trading/` | Crypto trading bot development (ccxt, strategy, backtesting) |
| **Content Writer** | `skills/content-writer/` | Blog posts, scripts, social media copy |
| **Research** | `skills/research/` | Deep research methodology and tools |
| **Session Briefing** | `skills/session-briefing/` | Pre-computed situational briefing for Claude Code SessionStart hook |
| **Automation** | `skills/automation/` | Cron jobs, webhooks, scheduled tasks |
| **Social Media** | `skills/social-media/` | Content creation, platform optimization (API posting TBD) |

## Tool Paths Inside Container
All tools are at `/app/skills/<skill-name>/` inside the Docker container.
From the host, they're at `/root/overlord/skills/<skill-name>/`.

## LLM Tools (via OpenRouter)

Installed via `llm` CLI + `llm-openrouter` plugin. One API key, hundreds of models.

| Model | Command | Notes |
|-------|---------|-------|
| **Gemini Flash** | `llm -m openrouter/google/gemini-2.0-flash-exp:free "prompt"` | Free, fast |
| **DeepSeek V3** | `llm -m openrouter/deepseek/deepseek-chat-v3-0324:free "prompt"` | Free, great for code |
| **Llama 3.3 70B** | `llm -m openrouter/meta-llama/llama-3.3-70b-instruct:free "prompt"` | Free, general purpose |
| **Gemma 3 27B** | `llm -m openrouter/google/gemma-3-27b-it:free "prompt"` | Free, Google |
| **DeepSeek R1** | `llm -m openrouter/deepseek/deepseek-r1:free "prompt"` | Free, reasoning |
| **Pipe data** | `echo "text" \| llm -m openrouter/... "summarize"` | Works with any model |
| **List models** | `llm models` | Show all available |

## Quick Examples
```bash
# Database health across all containers
db-admin.sh health

# Scan all containers for errors
log-analyzer.sh health

# Security audit
security-scan.sh full

# Backup verification
backup-verify.sh check

# Git status across all repos
git-intel.sh status

# Today's calendar
calendar.sh today

# System snapshot
perf-profile.sh snapshot

# Send notification (WhatsApp → Discord → Email fallback)
notify.sh send "Deploy complete"

# Generate an image
image-gen.sh generate "sunset over Caribbean marina" --style photorealistic

# Read a PDF
doc-reader.py read /path/to/document.pdf

# DNS management
dns-manager.sh list namibarden.com

# Send an email
email-compose.sh send "client@example.com" "Subject" "Body text"
```

## Claude Code Project Skills (at `/root/projects/.claude/skills/`)

These are Claude Code session skills (not Overlord bot skills). They have their own registry at `/root/projects/.claude/skills/REGISTRY.md`.

**Upgraded folder skills (scripts + gotchas):** deploy, coolify, logs, db-ops, dns, audit, github
**Methodology skills (gotchas):** systematic-debugging, test-site, scrape
**Tool skills (scripts + references):** playwright-skill, scraper-2, visualise
