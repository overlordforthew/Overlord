---
name: OnlyHulls scraper pipeline state
description: Current inventory (14,759 boats, 13 sources), running jobs, integrity issues, and next steps as of 2026-03-31
type: project
---

## Inventory: 14,759 active boats from 13 sources (2026-03-31 16:00 UTC)

| Source | Boats | Scraper Type | Notes |
|--------|-------|-------------|-------|
| Sailboat Listings | 10,645 | Scrapling detail | Bulk 16K done |
| TheYachtMarket | 3,628 | Scrapling+SSH proxy | Hetzner blocked, uses ElmoServer |
| Dream Yacht Sales | 97 | Playwright | |
| Camper & Nicholsons | 89 | Playwright | Superyachts, $15M+ avg |
| Apollo Duck US | 87 | Playwright | |
| Catamarans.com | 83 | Scrapling detail | |
| CatamaranSite | 43 | Playwright | |
| Denison Yachting | 20 | Scrapling | |
| Multihull Company | 15 | Playwright | |
| VI Yacht Broker | 15 | Playwright | |
| Moorings Brokerage | 14 | Scrapling JSON-LD | |
| Multihull World | 12 | Playwright | |
| Boote & Yachten | 11 | Playwright | |

## Integrity Issues (2026-03-31 audit)
- **3,347 boats with no location** (mostly old TYM index-only scrape) → Fix with TYM backfill
- **3,595 boats with only 1 image** (old TYM scrape got 1 thumbnail) → Fix with TYM backfill
- **Only 1 boat has a description** → TYM backfill will add descriptions
- **421 boats with no model** (387 from Sailboatlistings) → Cosmetic, single-name brands
- **98 short makes** (S2, LM, CS, J) → Real brands, not parse errors
- **981 no images** → Sellers didn't upload, legitimate
- **0 duplicate source_urls**, 0 bad prices, 0 missing years/makes → Clean

## Running Jobs (as of 2026-03-31 ~19:00 UTC)
- **TYM bulk scrape**: PID 1480813, 500/6000 complete (~8%), routing via ElmoServer SSH. Log: `/tmp/bulk-tym.log`. Batches of 500 with 60s pauses.
- After TYM bulk: run `--update` mode to backfill existing 3,628 boats with full specs/images/descriptions

## Key Infrastructure
- Daily cron: `37 5 * * *` runs `/root/projects/OnlyHulls/scripts/daily-scrape.sh`
- TYM scraper auto-detects 503 and switches to ElmoServer (100.89.16.27) via SSH
- Bulk outputs: `_bulk.json` suffix to avoid daily cron clobbering
- Import: `scripts/import-scraped.ts` — $500 min, 25ft min, dedup by source_url
- Upsert mode: `--update` flag for backfilling existing boats
- Smart tagging: Groq free tier limited to ~525 boats/day
- Integrity skill: `/root/.claude/skills/scrape-integrity.md`
- **Data integrity is Gil's top priority** for OnlyHulls — "utmost importance" (2026-03-31)
- Bug found 2026-03-31: ePropulsion Spirit 1 (electric motor, not a boat) passed 25ft filter → scraper filter tightened

## Scraper Files
All in `/root/projects/OnlyHulls/scraper/`:
- TYM detail-page scraper with SSH proxy fallback, structured spec extraction
- Sailboatlistings detail-page scraper with bulk/daily modes
- 8 Playwright scrapers via `pw_fetch.py` shared context
- 3 other Scrapling scrapers (catamarans, moorings, denison)
