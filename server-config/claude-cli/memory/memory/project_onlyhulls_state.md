---
name: OnlyHulls current state
description: OnlyHulls project status as of 2026-03-30 — scraper pipeline, inventory, architecture decisions, and next steps
type: project
---

## Status: Live at onlyhulls.com, pivoting to content/comparison + marketplace

**Inventory (2026-03-30):** 198 active boats from 3 sources
- Sailboat Listings: 187 boats (primary source, pure FSBO sail)
- Moorings Brokerage: 7 boats (charter exit fleet cats)
- Apollo Duck: 4 boats (cruisers, images hotlink-blocked)
- All fake/sample boats removed on 2026-03-30

**Scraper Pipeline:**
- 5 Python scrapers: sailboatlistings, apolloduck, theyachtmarket, catamarans_com, moorings
- Daily cron at 5:37am UTC via `/root/projects/OnlyHulls/scripts/daily-scrape.sh`
- Import: `scripts/import-scraped.ts` — ON CONFLICT dedup (source_url unique + make/model/year/location)
- Freshness: `last_seen_at` bumped on re-scrape, `scripts/expire-stale.ts` marks 14-day-unseen as expired
- Scraping costs $0 — pure Python regex + HTML parsing, zero LLM tokens
- Master site directory: `documents/boat-sites-directory.md` (106 sites verified for scrapability)

**Key Architecture Decisions:**
- Images are hotlinked (just URL strings in boat_media), not copied to S3 — zero storage cost
- Dual currency: `asking_price` (original) + `asking_price_usd` (converted at import)
- Source attribution: `source_site`, `source_name`, `source_url` on every imported boat
- Dashboard routes gated behind auth via `(dashboard)/layout.tsx`
- Boats page: "Load More" (no pagination), 30/batch, sorted price ascending
- Sort toggles: Price/Size/Year/Newest, tap to reverse

**Coolify Deploy:**
- UUID: `qkggs84cs88o0gww4wc80gwo`
- API via `localhost:8000` (public URL blocked)
- Restart: `curl -s -X POST "http://localhost:8000/api/v1/applications/qkggs84cs88o0gww4wc80gwo/restart" -H "Authorization: Bearer $COOLIFY_API_TOKEN"`
- GH_TOKEN lacks `workflow` scope — can't push .github/workflows/ files

**Pricing Model:**
- AI matching requires sign-up (free)
- AI agent continuous search: $10/mo (Plus tier)
- Seller: Free (1 listing) / Creator $30/mo / Featured $50/mo

**Why:** OnlyHulls pivoted from pure marketplace to content/comparison site on 2026-03-30. Cold-start marketplace problem unsolved — content drives traffic first, marketplace layers on top.

**How to apply:** Always check `documents/boat-sites-directory.md` before adding new scrapers. Use the import pipeline pattern (Python scraper → JSON → import-scraped.ts). Never add LLM calls to scraping — it's $0 and should stay that way.
