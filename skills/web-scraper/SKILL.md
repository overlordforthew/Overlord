# Skill: Web Scraper

## Scope
Extract data from any website — articles, prices, tables, listings, RSS feeds.

## Available Tools

### scrape.py
Fetch a URL and extract clean text or structured data.
```bash
python3 /app/skills/web-scraper/scrape.py "https://example.com"                    # Clean text
python3 /app/skills/web-scraper/scrape.py "https://example.com" --links             # Extract all links
python3 /app/skills/web-scraper/scrape.py "https://example.com" --tables            # Extract tables as CSV
python3 /app/skills/web-scraper/scrape.py "https://example.com" --selector "h2.title" # CSS selector
python3 /app/skills/web-scraper/scrape.py "https://example.com" --json              # Output as JSON
```

### rss.py
Read RSS/Atom feeds and extract recent articles.
```bash
python3 /app/skills/web-scraper/rss.py "https://feeds.bbci.co.uk/news/rss.xml"     # Latest headlines
python3 /app/skills/web-scraper/rss.py "https://feed-url" --limit 5                 # Limit results
python3 /app/skills/web-scraper/rss.py "https://feed-url" --json                    # JSON output
```

### search-scrape.py
Scrape Google search results for a query (lightweight, no API key).
```bash
python3 /app/skills/web-scraper/search-scrape.py "best crypto exchanges 2026"
```

## Notes
- For JavaScript-heavy sites, Claude can use WebFetch tool instead
- These scripts use requests + BeautifulSoup (fast, no browser needed)
- Respects robots.txt by default — use --force to override
- Rate-limited: 1 request per second to avoid blocks

## When to Use
- User asks to "check a website", "get data from", "scrape", "pull info"
- Need to extract specific data (prices, tables, listings) from a page
- Need to monitor a page for changes
- Reading RSS/news feeds
