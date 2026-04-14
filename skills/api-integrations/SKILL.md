# Skill: API Integrations

## Scope
Live data from external APIs — crypto prices, weather, news, exchange rates. No API keys needed for these.

## Available Tools

### crypto.py
Live cryptocurrency prices from CoinGecko (free, no API key).
```bash
python3 /app/skills/api-integrations/crypto.py                           # Top 10 by market cap
python3 /app/skills/api-integrations/crypto.py bitcoin ethereum solana   # Specific coins
python3 /app/skills/api-integrations/crypto.py --top 25                  # Top 25
python3 /app/skills/api-integrations/crypto.py bitcoin --detail          # Detailed info
python3 /app/skills/api-integrations/crypto.py --json                    # JSON output
```

### weather.py
Weather data from wttr.in (free, no API key).
```bash
python3 /app/skills/api-integrations/weather.py "Port of Spain"          # Current weather
python3 /app/skills/api-integrations/weather.py "Port of Spain" --forecast  # 3-day forecast
python3 /app/skills/api-integrations/weather.py --json "New York"        # JSON output
```

### news.py
News headlines from major RSS feeds (free, no API key).
```bash
python3 /app/skills/api-integrations/news.py                             # Top headlines
python3 /app/skills/api-integrations/news.py --topic tech                # Tech news
python3 /app/skills/api-integrations/news.py --topic crypto              # Crypto news
python3 /app/skills/api-integrations/news.py --topic business            # Business news
python3 /app/skills/api-integrations/news.py --json                      # JSON output
```

### exchange.py
Currency exchange rates (free, no API key).
```bash
python3 /app/skills/api-integrations/exchange.py USD TTD                 # USD to Trinidad Dollar
python3 /app/skills/api-integrations/exchange.py 100 USD EUR             # Convert 100 USD to EUR
python3 /app/skills/api-integrations/exchange.py --list                  # Available currencies
```

## When to Use
- User asks about crypto prices, market status
- User asks about weather anywhere
- User asks for news/headlines
- User needs currency conversion
- Any "what's the current..." type question
