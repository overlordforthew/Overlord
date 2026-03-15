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

## Skills with Instructions Only

| Skill | Directory | Description |
|-------|-----------|-------------|
| **Server Admin** | `skills/server-admin/` | Docker, Coolify, UFW, Tailscale, backups, security procedures |
| **WhatsApp** | `skills/whatsapp/` | Chat behavior, group rules, admin commands, media handling |
| **Video Pipeline** | `skills/video-pipeline/` | Nami's meditation videos: script → voice → visuals → publish |
| **Web Dev** | `skills/web-dev/` | Full-stack dev → GitHub push → Coolify auto-deploy |
| **Mobile Dev** | `skills/mobile-dev/` | Capacitor wrapping for Android/iOS |
| **Trading** | `skills/trading/` | Crypto trading bot development (ccxt, strategy, backtesting) |
| **Content Writer** | `skills/content-writer/` | Blog posts, scripts, social media copy |
| **Research** | `skills/research/` | Deep research methodology and tools |
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
/app/skills/database-admin/scripts/db-admin.sh health

# Table sizes in overlord
/app/skills/database-admin/scripts/db-admin.sh sizes overlord-db overlord

# Check if all services are running
/app/skills/monitoring/service-check.sh --brief

# Get Bitcoin price
python3 /app/skills/api-integrations/crypto.py bitcoin --detail

# Weather in Port of Spain
python3 /app/skills/api-integrations/weather.py "Port of Spain"

# Scrape a webpage
python3 /app/skills/web-scraper/scrape.py "https://example.com"

# Stealth scrape (bypasses anti-bot protections)
python3 /app/skills/scrapling/scrape-stealth.py "https://protected-site.com"

# Stealth scrape with CSS selector
python3 /app/skills/scrapling/scrape-stealth.py "https://example.com" --selector "div.price" --json

# Read tech news
python3 /app/skills/api-integrations/news.py --topic tech

# Convert currency
python3 /app/skills/api-integrations/exchange.py 100 USD TTD

# Analyze a CSV file
python3 /app/skills/data-analysis/analyze.py /path/to/data.csv
```
