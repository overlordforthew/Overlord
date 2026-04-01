---
name: OnlyHulls cross-listing strategy
description: Free vs paid cross-listing platforms for boat syndication — free ones first, paid later
type: project
---

## Free Cross-Listing — Priority

**Sailboatlistings.com** is the only free platform Gil sees value in right now. No API, but free to list — automate with Playwright (we already scrape it, so we know the HTML).

Gil ruled out the others for now (2026-03-31):
- **Facebook Marketplace** — "tough on bots", automation is risky
- **Craigslist** — "bulk difficulties", requires manual work
- **Apollo Duck** — free photo ads but low priority
- **eBay Motors** — $20/listing, not truly free

## Paid Cross-Listing (LATER)

| Platform | Method | Cost | Reach |
|----------|--------|------|-------|
| **Boatvertizer** | NautiX XML feed → 17 portals | EUR 80-450/mo | TYM, Apollo Duck, Boat24, YachtAll, Rightboat, etc |
| **eBay Motors** (bulk) | Trading API | $20/listing | High traffic US |
| **CatamaranSite/YachtSite** | Manual | $199/3mo per listing | Niche catamaran buyers |
| **BoatsGroup** (YachtWorld/BoatTrader) | BoatWizard subscription | $300-1000+/mo | Biggest but hostile to competitors |
| **YATCO** | DEX Feed / 2-Way API | Custom pricing | Superyacht segment |

## Seller Pricing Model (future)
- Free tier: OnlyHulls only
- Premium ($29-49/listing/mo or $99/mo unlimited): Syndicate to free + paid platforms
- Revenue covers Boatvertizer + eBay fees with margin

**Why:** Gil wants free cross-listing NOW to increase listing value and attract sellers. Paid syndication is Phase 2 after revenue. But only sailboatlistings.com is worth building now — the others have too many bot/bulk barriers.

**How to apply:** Build sailboatlistings.com auto-poster first (Playwright). NautiX XML feed is the long-term architecture that unlocks 17+ paid portals later. Don't invest time in FB/CL/Apollo Duck automation yet.
