---
name: OnlyHulls Business Model
description: OnlyHulls marketplace business model — free marketplace, paid AI intelligence. Key product decisions from 2026-04-01.
type: project
---

OnlyHulls is an AI-powered boat marketplace at onlyhulls.com. Key business decisions made 2026-04-01:

**Business model:** Marketplace is free. AI intelligence is what costs.
- Free tier: unlimited browsing, searching, contacting sellers — zero friction
- Plus ($10/mo): AI profiling, match breakdowns, instant alerts, cross-site search, dreamboard
- Pro tier: REMOVED (merged into Plus on 2026-04-01)
- Seller tiers: Free (1 listing), Creator ($30/mo), Featured Creator ($50/mo)

**Key product decisions:**
- "Contact Owner" on scraped listings (99% of catalog) now shows a soft gate modal with "Save & Continue" (signup-gated) and "Continue as Guest" (pass-through). All clicks logged to `contact_clicks` table for intent tracking.
- Data integrity checker (`scraper/check_integrity.py`) validates scraped JSON before import — catches missing images, non-English descriptions, price floors, dinghies
- Boats without images sorted to bottom of catalog. Trending requires $3k+ price.

**Why:** Gil thinks like Garry Tan / YC — what makes buyers and sellers happy. The platform should not gate basic marketplace functions behind paywalls. Intelligence and AI tools are the premium.

**How to apply:** Never gate contacting sellers behind payment. When adding features, ask "is this a basic marketplace function (free) or AI intelligence (paid)?" Default to free.
