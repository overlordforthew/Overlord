---
name: OnlyHulls UX preferences
description: Gil's confirmed UX and design preferences for OnlyHulls — pagination, sorting, pricing display, cursors
type: feedback
---

Load More over pagination — Gil explicitly dislikes "next page" navigation. Use a "Show More (N remaining)" button.

**Why:** Gil finds pagination interrupts browsing flow. Load More keeps context.

**How to apply:** All listing views use append-on-click, not page navigation.

---

Price format: `$3,000` not `$3,000.00` — no decimals, proper commas, correct currency symbol ($/£/€). Non-USD listings show original currency on top, ~USD conversion below.

**Why:** Gil flagged raw decimal prices as hard to read.

---

Sort toggles: tap once to sort, tap again to reverse. Active sort shows directional arrow, inactive shows neutral icon. Default: price ascending.

**Why:** Gil requested this as a "cool" interaction — hit once, it reverses.

---

Cursor: `cursor-pointer` on all CTA buttons. Gil noticed the default arrow cursor on "Get Matched" and wanted the hand.

---

Dashboard auth gate: ALL routes under `(dashboard)/` require sign-in. Gil caught that the AI profiler was accessible without authentication. Fixed with a layout.tsx server-side redirect.

---

Apollo Duck images: hotlink-protected (CDN returns 400 from external referers). Don't store these URLs — they won't render. Fixed by disabling image scraping for apolloduck.
