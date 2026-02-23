# Skill: Amadeus Travel

## Scope
Flight search, hotel search, points of interest, and IATA code lookup via Amadeus Self-Service API.
Requires `AMADEUS_CLIENT_ID` and `AMADEUS_CLIENT_SECRET` env vars (free tier: ~2,000 flight req/month, ~3,000 pricing).

## Available Tools

### amadeus.py — Flight Search
```bash
python3 /app/skills/amadeus-travel/amadeus.py flight CDG JFK 2026-04-01                       # One-way Paris→NYC
python3 /app/skills/amadeus-travel/amadeus.py flight CDG JFK 2026-04-01 --return 2026-04-08    # Round-trip
python3 /app/skills/amadeus-travel/amadeus.py flight MIA LAX 2026-05-01 --adults 2 --nonstop   # 2 adults, direct only
python3 /app/skills/amadeus-travel/amadeus.py flight LHR NRT 2026-06-01 --class business       # Business class
python3 /app/skills/amadeus-travel/amadeus.py flight CDG JFK 2026-04-01 --json                 # JSON output
```

### amadeus.py — Hotel Search
```bash
python3 /app/skills/amadeus-travel/amadeus.py hotel PAR 2026-04-01 2026-04-03                  # Hotels in Paris
python3 /app/skills/amadeus-travel/amadeus.py hotel NYC 2026-05-01 2026-05-05 --adults 2       # 2 adults
python3 /app/skills/amadeus-travel/amadeus.py hotel LON 2026-06-01 2026-06-03 --rooms 2        # 2 rooms
python3 /app/skills/amadeus-travel/amadeus.py hotel PAR 2026-04-01 2026-04-03 --ratings 4 5    # 4-5 star only
python3 /app/skills/amadeus-travel/amadeus.py hotel PAR 2026-04-01 2026-04-03 --json           # JSON output
```

### amadeus.py — Points of Interest
```bash
python3 /app/skills/amadeus-travel/amadeus.py poi 48.8566 2.3522                               # POIs near Paris center
python3 /app/skills/amadeus-travel/amadeus.py poi 40.7128 -74.0060 --radius 5                  # NYC, 5km radius
python3 /app/skills/amadeus-travel/amadeus.py poi 48.8566 2.3522 --category RESTAURANT         # Restaurants only
python3 /app/skills/amadeus-travel/amadeus.py poi 48.8566 2.3522 --json                        # JSON output
```
Categories: SIGHTS, RESTAURANT, SHOPPING, NIGHTLIFE, BEACH_PARK

### amadeus.py — IATA Code Lookup
```bash
python3 /app/skills/amadeus-travel/amadeus.py iata "Paris"                                     # Find IATA codes
python3 /app/skills/amadeus-travel/amadeus.py iata "New York"                                  # City/airport lookup
python3 /app/skills/amadeus-travel/amadeus.py iata "Tokyo" --json                              # JSON output
```

## When to Use
- User asks about flights, airfare, or travel between cities
- User asks about hotels or accommodation
- User wants to know what's around a location (restaurants, sights, etc.)
- User needs an IATA code for a city or airport
- Any "find me a flight...", "how much to fly to...", "hotels in..." type question
- Use `iata` subcommand first if you need to resolve city names to IATA codes
