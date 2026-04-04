---
name: MasterCommander Status
description: Active project status — recent energy table fix, planned nearby-places feature, deployment notes.
type: project
---

## Current state (2026-04-03)

MasterCommander is actively iterated. Dashboard at mastercommander.namibarden.com, deployed via `docker cp` (no Coolify webhook).

## Recent work (2026-04-03)

- **Energy table fix** — Dashboard energy panel didn't match Gil's actual Victron inverter readings. Fixed energy calculations, updated background color to match dashboard theme, clarified confusing "Power & Net" labels.
- **Log data storage** — Gil wants to evaluate boat telemetry log storage to ensure it's in good order for analysis. Status: discussed, not yet audited.

## Planned: Nearby Places feature

Gil brought a Google Places Nearby Search task brief (from Claude web). Design decisions made:

1. Build as a **digestion module** (`digestion/nearby-places.js`), not a standalone host script
2. **Auto-pull position from SignalK** — MasterCommander already knows boat coordinates, so no manual lat/lon needed
3. Integrate with **existing WhatsApp conversational interface** — let the LLM parse "find me a pharmacy" rather than a slash command with raw args
4. Check if existing `GOOGLE_API_KEY` works with Places API (New) before creating a separate key
5. Uses native `fetch`, zero dependencies

**Why:** "What's the closest supermarket/laundromat?" is a daily question when anchored somewhere new. This is a natural fit for MasterCommander's role as the boat's AI.

**How to apply:** When building this feature, register it in `commander.js` like other digestion modules. Hook into the WhatsApp handler for user queries. The field mask should use Basic fields only (cheapest tier, well within $200/month free credit).
