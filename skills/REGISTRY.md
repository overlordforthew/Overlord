# Skill Registry

Quick reference of all available skills and their tools. Read the SKILL.md in each directory for full details.

## Skills with Executable Tools

| Skill | Directory | Tools | Description |
|-------|-----------|-------|-------------|
| **Monitoring** | `skills/monitoring/` | `service-check.sh`, `ssl-check.sh`, `disk-alert.sh` | Server health, container status, SSL certs, resource alerts |
| **Web Scraper** | `skills/web-scraper/` | `scrape.py`, `rss.py`, `search-scrape.py` | Extract data from any URL, read RSS feeds, search the web |
| **API Integrations** | `skills/api-integrations/` | `crypto.py`, `weather.py`, `news.py`, `exchange.py` | Live crypto prices, weather, news headlines, currency conversion |
| **Data Analysis** | `skills/data-analysis/` | `analyze.py`, `chart.py` | Process CSV/JSON, statistics, filtering, chart generation |

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

## Quick Examples
```bash
# Check if all services are running
/app/skills/monitoring/service-check.sh --brief

# Get Bitcoin price
python3 /app/skills/api-integrations/crypto.py bitcoin --detail

# Weather in Port of Spain
python3 /app/skills/api-integrations/weather.py "Port of Spain"

# Scrape a webpage
python3 /app/skills/web-scraper/scrape.py "https://example.com"

# Read tech news
python3 /app/skills/api-integrations/news.py --topic tech

# Convert currency
python3 /app/skills/api-integrations/exchange.py 100 USD TTD

# Analyze a CSV file
python3 /app/skills/data-analysis/analyze.py /path/to/data.csv
```
