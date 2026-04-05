---
name: MasterCommander Feature Status
description: What's built, deployed, and next for MasterCommander as of 2026-04-04. Tracks implementation state.
type: project
---

## Deployed Features (2026-04-04)

**Website (mastercommander.namibarden.com):**
- Landing page: Cerbo GX architecture, public (no gate), corrected marketing copy
- Dashboard: fleet view, boat telemetry, settings with units, demo mode
- Chart: Leaflet map, AIS targets, anchor alarm with approach track, route planner
- Unit preferences: depth (m/ft/fathoms), distance (nm/km/mi), speed (kts/mph/m/s), temp (C/F), pressure (hPa/inHg/mbar), volume (L/gal). Settings page + localStorage.

**Backend (digestion/):**
- LLM router: OpenRouter Qwen 3.6 Plus, dual-mode infrastructure (Promise.any), response logging
- Alert engine: 10 rule-based alerts (battery, engine, depth, anchor, bilge, tanks)
- Advisor: tactical, weather, energy modules on 30-60s intervals
- Anchor alarm: manual set/clear, approach track (2hr ring buffer), drift detection
- Trips: auto-detection, distance/fuel/duration tracking
- Maintenance: interval-based tracking, overdue alerts
- Data retention: raw (7d), hourly rollups (90d), daily (forever), llm_responses (forever)
- Telemetry ingest: POST API from collector, translateSnapshot, PostgreSQL storage

**Collector:**
- Blue Moon specific: `collector-cerbo.py` (634 lines, Cerbo + Zeus 3 + GoFree)
- Generic: `collector-generic.py` (~230 lines, Cerbo-only, auto-discovers equipment)
- Install scripts: `install.sh` (SSH), `nodered-flow.json` (Node-RED)

**Codex Review (2026-04-04):** 3 reviews ran (gpt-5.4, xhigh), 344K tokens. All P1/P2/P3 findings fixed:
- Promise.any for dual race, /rate await timing, boat_id dynamic, marketing accuracy
- XSS escaping, collector crash protection, stale data tracking, installer config safety
- Mobile overflow, mojibake

## Not Yet Built

- **Commander App** (React Native) — MQTT discovery, local dashboard, on-device Gemma 3n, Cerbo installer flow
- **Zero-config questionnaire** — 5-6 questions, AI auto-configures thresholds + dashboard
- **WhatsApp re-link** — MC container has `MC_NO_WHATSAPP=1`, needs its own device session
- **Fine-tuning** — need 200-500 rated training examples first
