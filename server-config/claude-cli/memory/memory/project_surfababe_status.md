---
name: SurfaBabe Active Work
description: SurfaBabe pixel-perfect Wix replication status and Stripe payments decision as of 2026-03-28
type: project
---

## Pixel-Perfect Replication (in progress as of 2026-03-28)

Replicating www.surfababe.com (Wix original) to surfababe.namibarden.com (custom Express/static site). Homepage is close, sub-pages (buy, faq, product pages) needed significant work on nav, footer, and content matching.

**Why:** Ailie's (Gil's partner) business site. Must match the Wix original exactly before adding new features.

**How to apply:** When working on SurfaBabe, visual fidelity to the Wix original is the top priority. Use Chrome DevTools MCP for side-by-side comparison.

## Stripe Payments Decision

- **Same Stripe account as NamiBarden** (recommended, Gil hasn't objected) — single dashboard, single payout, already KYC-verified
- Currency: VND (Vietnamese Dong, minimum 10,000 VND per Stripe rules)
- Mode: one-time payments only, no subscriptions
- 7-9 products, prices in VND (180,000 - 300,000 range)
- Keep WhatsApp "Order" button as alternative alongside "Buy Now"
- Plan file: `/root/.claude/plans/twinkling-bubbling-sparrow.md`

**Why:** SurfaBabe sells physical products (tallow cream, sunscreen, cleaners, laundry detergent) — simple checkout, no recurring billing needed.

**How to apply:** When implementing Stripe for SurfaBabe, copy patterns from NamiBarden's server.js (lines 504-940) but simplify — remove subscription logic, use `payment` mode only.
