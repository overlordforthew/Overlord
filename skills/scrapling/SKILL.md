# Skill: Scrapling — Stealth Web Scraping

## Scope
Advanced web scraping that bypasses anti-bot protections (Cloudflare, Turnstile, etc.) using TLS fingerprint spoofing, browser-realistic headers, and smart element tracking. Falls back to simple HTTP when stealth isn't needed.

## Available Tools

### scrape-stealth.py
Stealth-capable URL scraper with multiple fetcher tiers.

```bash
# Basic scrape (stealth HTTP with TLS fingerprinting)
python3 /app/skills/scrapling/scrape-stealth.py "https://example.com"

# Extract links
python3 /app/skills/scrapling/scrape-stealth.py "https://example.com" --links

# Extract tables
python3 /app/skills/scrapling/scrape-stealth.py "https://example.com" --tables

# CSS selector extraction
python3 /app/skills/scrapling/scrape-stealth.py "https://example.com" --selector "div.price"

# JSON output
python3 /app/skills/scrapling/scrape-stealth.py "https://example.com" --json

# Follow pagination (max 5 pages)
python3 /app/skills/scrapling/scrape-stealth.py "https://example.com" --follow-next --max-pages 5

# Save to file
python3 /app/skills/scrapling/scrape-stealth.py "https://example.com" --output /tmp/scraped.txt
```

## When to Use
- Target site blocks normal requests (403, Cloudflare challenge)
- Need data from JS-heavy sites that basic scraping misses
- Existing scrape.py fails or returns incomplete data
- Need to follow pagination across multiple pages
- Scraping marine weather, port info, boat listings, or any protected site

## Key Features
- TLS fingerprint impersonation (looks like Chrome/Firefox)
- Browser-realistic headers via browserforge
- Smart element tracking (finds elements even when HTML changes)
- Auto-match CSS selectors across page updates
- Built on Scrapling library (curl_cffi + lxml)
