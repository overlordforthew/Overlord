# Skill: X/Twitter Trends

## Scope
Trending topics on X/Twitter, tweet search, and user profile lookups. Uses twikit (free, no API key cost) with fallback scrapers for trends.

## Available Tools

### xtrends.py trends
Get currently trending topics on X (worldwide).
```bash
python3 /app/skills/x-trends/xtrends.py trends                    # Top 20 trends
python3 /app/skills/x-trends/xtrends.py trends --count 10         # Top 10
python3 /app/skills/x-trends/xtrends.py trends --json             # JSON output
python3 /app/skills/x-trends/xtrends.py trends --fallback-only    # Skip twikit, use scrapers
```
Falls back to GetDayTrends.com → Trends24.in if twikit auth unavailable.

### xtrends.py search
Search tweets on X (requires X account credentials).
```bash
python3 /app/skills/x-trends/xtrends.py search "bitcoin"                  # Top tweets
python3 /app/skills/x-trends/xtrends.py search "bitcoin" --mode Latest    # Latest tweets
python3 /app/skills/x-trends/xtrends.py search "bitcoin" --count 20       # More results
python3 /app/skills/x-trends/xtrends.py search "bitcoin" --json           # JSON output
```

### xtrends.py user
Look up an X user's profile and recent tweets (requires X account credentials).
```bash
python3 /app/skills/x-trends/xtrends.py user elonmusk              # Profile info
python3 /app/skills/x-trends/xtrends.py user elonmusk --tweets     # Profile + recent tweets
python3 /app/skills/x-trends/xtrends.py user elonmusk --json       # JSON output
```

## When to Use
- User asks "what's trending on X/Twitter?"
- User asks to search X for a topic (e.g., "search X for bitcoin news")
- User asks about a specific X account or wants to see someone's tweets
- Any question about what's happening/trending on social media

## Authentication
- **Trends:** Works without auth (fallback scrapers), better with auth (twikit)
- **Search & User:** Requires X_USERNAME, X_EMAIL, X_PASSWORD in .env
- Recommend a burner X account (internal API usage, risk of suspension)
- Account must NOT have 2FA enabled

## Caching
- Trends: 1 hour TTL
- Search: 30 minute TTL
- User profiles: 1 hour TTL
- Cache stored at /tmp/x_cache/
