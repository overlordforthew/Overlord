# Session Handoff — 2026-03-30 20:30 UTC

## What Was Done

### Strategic Analysis
- Lean Canvas, competitive battlecard (YachtWorld antitrust), GTM strategy
- Brand tagline locked: "Where Tinder™ collides with OnlyFans™ — for boats"

### Scraping Infrastructure
- **4 active scrapers** in daily cron (5:37am UTC): sailboatlistings, theyachtmarket, catamarans.com, moorings
- **Master directory**: 115+ boat sites verified from Hetzner IP. Every site tested for scrapability, listing count, price availability, anti-bot protection. File: `/root/projects/OnlyHulls/documents/boat-sites-directory.md`
- **30-boat data integrity audit** completed on all 25 candidate sites
- **Import pipeline**: `scripts/import-scraped.ts` with ON CONFLICT dedup, 25ft minimum, USD conversion, last_seen_at freshness tracking
- **Stale detection**: 14-day expiry for imported boats not seen by scrapers
- **Groq smart tagging**: `scripts/smart-tag.ts` — Llama 3.3 70B classifies boats (liveaboard-ready, bluewater, classic, etc.) $0 cost. 166 boats tagged.
- **10 new scraper files written** but 9/10 need regex fixes (prices in HTML but link patterns wrong)

### Frontend / UX
- Sort toggles (price/size/year/newest, tap to reverse)
- "Load More" replacing pagination (30 per batch)
- Dual currency (listing currency + USD conversion)
- Source attribution badges ("via Sailboat Listings")
- PostHog script tag in layout (needs NEXT_PUBLIC_POSTHOG_KEY in Coolify)
- View counter on boat detail pages, trending by view_count
- Auth gate on dashboard routes (AI matching requires sign-in)
- cursor:pointer on CTA buttons
- 25ft minimum filter (no dinghies)
- Clean price formatting ($3,000 not $3000.00)
- CSP headers + image domain whitelist in next.config.ts

### Database
- 358 active boats from 2 sources (Sailboat Listings 172, TheYachtMarket 186)
- Migrations 008-010: source attribution, listing freshness, view tracking
- Groq-tagged 166 boats with AI character tags

## What's In Progress

### Scraper Fixes Needed (THE MAIN BLOCKER)
The core discovery: **most sites render prices via JavaScript, not static HTML.** Scrapling (our Python scraper library) only reads static HTML. The audit agents used WebFetch (JS-capable) which saw prices, but our scrapers can't.

**5 sites with prices in static HTML (fixable with regex):**
| Site | Prices in HTML | Issue |
|------|---------------|-------|
| denisonyachtsales.com | 60 | Link pattern regex wrong |
| catamaransite.com | 44 | Link pattern regex wrong |
| multihullcompany.com | 15 | Price-to-link association broken |
| camperandnicholsons.com | 12 | Price-to-link association broken |
| multihullworld.com | 10 | Partial price extraction |

**4 sites that NEED Playwright/StealthyFetcher (JS-rendered prices):**
| Site | Issue |
|------|-------|
| apolloduck.us | 0 prices in static HTML |
| virginislandsyachtbroker.com | 0 links, 0 prices in static |
| dreamyachtsales.com | 0 links in static |
| boote-yachten.de | 0 prices in static |

**Fix approach:** Use Scrapling's `StealthyFetcher` (headless browser mode) instead of `Fetcher` for JS-rendered sites. Or use the `/scrape` skill which has browser-based extraction.

### Bulk Scrape Not Started
- Sailboatlistings has 16,864 available but we only have 172 in DB
- TheYachtMarket has 5,700 but we only have 186
- Bulk scrape script (`--bulk` flag) exists but was killed when laptop lost power
- Need to run: `python3 scraper/scrape_sailboats.py --bulk 5000` (~1.5 hours)

## What's Next
- [ ] Fix 5 static-price scrapers (denison, catamaransite, multihullcompany, camperandnicholsons, multihullworld) — regex link patterns
- [ ] Switch 4 JS-rendered scrapers to StealthyFetcher or Playwright
- [ ] Run 30-boat integrity audit on each fixed scraper
- [ ] Add all working scrapers to daily-scrape.sh and import-scraped.ts SOURCES
- [ ] Run bulk scrape: sailboatlistings (16K), theyachtmarket (5.7K), catamarans.com (2K)
- [ ] Smart-tag all new imports via Groq
- [ ] Set NEXT_PUBLIC_POSTHOG_KEY in Coolify (Gil needs to sign up at posthog.com)
- [ ] SSR the boats page for SEO
- [ ] Swipe-card mobile UI for logged-in users
- [ ] Content/blog infrastructure

## Files Changed
- `/root/projects/OnlyHulls/scraper/` — 16 Python scrapers (6 working, 10 WIP)
- `/root/projects/OnlyHulls/scripts/import-scraped.ts` — Import pipeline with dedup, 25ft filter, USD conversion, freshness
- `/root/projects/OnlyHulls/scripts/smart-tag.ts` — Groq Llama 3.3 70B tagging ($0)
- `/root/projects/OnlyHulls/scripts/expire-stale.ts` — 14-day stale listing expiry
- `/root/projects/OnlyHulls/scripts/daily-scrape.sh` — 4-source daily cron
- `/root/projects/OnlyHulls/src/app/(public)/boats/page.tsx` — Load More + sort toggles
- `/root/projects/OnlyHulls/src/app/api/boats/route.ts` — Sort params, source fields, USD price
- `/root/projects/OnlyHulls/src/components/BoatCard.tsx` — Dual currency, source badges
- `/root/projects/OnlyHulls/src/app/(dashboard)/layout.tsx` — Auth gate
- `/root/projects/OnlyHulls/next.config.ts` — CSP headers, image domains
- `/root/projects/OnlyHulls/migrations/008-010` — Source attribution, freshness, view tracking
- `/root/projects/OnlyHulls/documents/boat-sites-directory.md` — 115+ sites verified

## State to Be Aware Of
- OnlyHulls Coolify UUID: `qkggs84cs88o0gww4wc80gwo`
- Coolify API: `http://localhost:8000` with token from `/root/overlord/.env`
- Daily cron active: `37 5 * * *` running daily-scrape.sh
- 358 active boats in DB, 15 expired (under 25ft), 1 expired (stale test)
- All sample/fake boats deleted
- Apollo Duck .com DROPPED from pipeline (prices JS-only, 0% importable)
- Groq API key in `/root/overlord/.env` (GROQ_API_KEY), model: llama-3.3-70b-versatile

## Decisions Made
- 25ft minimum for all imported boats (no dinghies, Lasers, Hobie 16s)
- Apollo Duck .com dropped (prices only in JS, images hotlink-protected)
- Apollo Duck .us discovered as alternative (has prices in SSR — per audit agents, but needs StealthyFetcher verification)
- Groq free tier for smart tagging over ElmoServer local LLM (faster, better quality, $0)
- Rightboat.com dropped (403 blocked from all fetchers)
- Static HTML scraping preferred over headless browser for speed/reliability
- Daily scrape uses first page only; bulk uses --bulk flag for full pagination

## Open Questions
- Gil needs to sign up at posthog.com and provide API key for analytics
- Should we invest in Playwright/StealthyFetcher for the 4 JS-rendered sites, or focus on maximizing the static-HTML sites first?
- GitHub Actions workflow needs PAT with `workflow` scope to push .github/workflows/
- The GH_TOKEN in /root/overlord/.env lacks `workflow` scope
