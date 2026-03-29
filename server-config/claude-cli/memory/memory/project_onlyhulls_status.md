---
name: OnlyHulls Active Work
description: OnlyHulls subscription billing plans, auth migration, and recent fixes as of 2026-03-28
type: project
---

## Subscription Billing Plans (defined, not yet enforced)

### Buyer Plans
| Plan | Price | Key Features |
|------|-------|-------------|
| Free | $0 | Browse, basic search, 10 saves/day |
| Plus | $10/mo | Advanced search, AI match profile, 3 seller connects/mo, dreamboard |
| Pro | $30/mo | Direct messaging, priority notifications, external boat search, instant alerts |

### Seller Plans (also defined in plan file)
- Plan file: `/root/.claude/plans/crispy-shimmying-breeze.md`

**Why:** Monetization strategy for onlyhulls.com. Stripe integration is ~70% built (checkout, webhook, portal APIs exist) but has placeholder keys and no enforcement.

**How to apply:** Feature gating must match these tiers. When implementing Stripe, use the tested pattern from SurfaBabe + NamiBarden.

## Auth Migration
- Migrated from **Clerk to Auth.js (NextAuth)** — completed
- Middleware at `src/middleware.ts` — public routes whitelist pattern
- Session: cookie-based via Auth.js

## Recent Fixes (2026-03-28)
- **MatchCTA bug:** Next.js `<Link>` cached initial href, sending logged-in users to /sign-up. Fixed: switched to `<button>` with `router.push()` + `useSession()` check at click time.
- **Middleware:** Added `/onboarding` to public routes so questionnaire is accessible.

## Stack
- Next.js (App Router) + Auth.js + PostgreSQL
- Coolify auto-deploy on git push
- Domain: onlyhulls.com
