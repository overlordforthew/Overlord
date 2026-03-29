---
name: MasterCommander Session Handoff
description: MasterCommander sailing app — demo system, intelligence layer, and next steps as of 2026-03-28
type: project
---

## What Was Done (2026-03-28)

### Sailing Intelligence Layer (Major Feature)
- gilsboat simulator: 45+ SignalK paths, AIS, 13 scenarios, PUT handler
- Polar engine: Catana 58 data, VMG, optimal TWA, % of polar
- Advisor framework: recommendation queue, accept/dismiss, dedup, history
- 3 intelligence modules: tactical, weather, energy — all wired into commander.js
- 7 new API endpoints: /api/advisor/*, /api/performance, /api/energy/projection
- 3 new dashboard panels: Advisor, Performance, Energy

### Demo System
- 5 real users in PostgreSQL (charter/marina/owner/captain/surveyor @demo.mc)
- 36 boats with full metadata
- Persona switcher: slide-up panel, actual login on switch

### Bugs Fixed
- cookie-parser missing in Overlord — root cause of all MC auth failures
- nginx /api/boats not proxied — fell through to SPA HTML
- Gate had no login form — added email+password form
- dashboard.js getUser() undefined, boat route regex, cache busting
- Password visibility toggle added, password reset flow working
- test@test.com users deleted — Gil uses gilbarden@gmail.com

## What's Next — Approved Plan

**Perfecting Individual Owner** (plan at `/root/.claude/plans/eager-knitting-gray.md`):

Phase 1 (NOT STARTED):
- [ ] Hide scenario buttons from normal users
- [ ] Fix Advisor Agree/Dismiss (frontend refresh after POST)
- [ ] Add baro + air temp to nav panel
- [ ] Fix empty fleet onboarding state
- [ ] Fix gate.js hasToken bug

Phase 2-4: Polish boat detail, connect alerts to advisor, onboarding flow.

**Why:** Gil wants each persona type to be 100% polished before moving to the next. Starting with Individual Owner (Gil's own use case).

**How to apply:** When working on MasterCommander, focus on individual owner flow. Don't scatter across persona types.

## Key Files
- Intelligence: `digestion/intelligence/*.js`
- Dashboard: `public/dashboard.js`, `public/telemetry.js`
- Simulator: `digestion/simulator.js`
- Commander: `digestion/commander.js`
- Gate: `public/gate.js`
