---
name: MasterCommander AI Strategy
description: AI model selection, architecture, scaling plan, and app architecture for MC boat intelligence. Cerbo GX + Commander App + Cloud AI.
type: project
---

## Architecture (Decided 2026-04-04)

MasterCommander reconfigured from Signal K + Raspberry Pi / Mac Mini to:
- **Cerbo GX** on NMEA 2000 via VE.Can cable → publishes data via MQTT on boat WiFi
- **Commander App** (phone/tablet) connects to MQTT locally, has on-device AI
- **Cloud AI** activates when internet available — deep analysis, WhatsApp alerts, fleet mgmt
- Cerbo needs a VE.Can to NMEA 2000 cable + MQTT on LAN enabled in settings (Codex verified against Victron docs)

## AI — Single Model: Qwen 3.6 Plus

**Decision (2026-04-04):** Use Qwen 3.6 Plus only, via OpenRouter free tier.
- ElmoServer dropped — not needed for MC
- Gemma 3 27B dropped — OpenRouter free-tier rate limits too aggressive
- Dual-model racing code exists in llm-router.js but config set to `provider: "openrouter"` (single model)
- Response time: 30-40s per query on free tier
- Config: `boat-config.json` → `llm.provider: "openrouter"`, `llm.openrouterModels: ["qwen/qwen3.6-plus:free"]`

**Test Results (2026-04-04):** Status, passage planning, safety/anchor queries all answered correctly. Flagged net power loss, calculated fuel range, caught alternator issue, advised on anchor scope.

**Future phone model:** Gemma 3n E2B (~1.2GB), bundled in Commander App. Job: natural language skin on pre-computed alerts (rule engine pre-digests). Does NOT analyze raw data.

## Cerbo GX Collector Install

Two paths, user chooses in app (app auto-detects available options by probing ports 22 and 1880):

**Path A — SSH (default):** User enables SSH on Cerbo screen. App connects, drops collector to `/data/mc/`, configures rc.local auto-start. Works on ALL Cerbo units.

**Path B — Node-RED:** App pushes flow via HTTP API port 1880. No password needed. Requires Venus OS Large.

**Files built:**
- `collector/collector-generic.py` — ~230 line generic collector, auto-discovers equipment via MQTT topics
- `collector/install.sh` — SSH installer, safe JSON config via Python, chmod 600 on config
- `collector/nodered-flow.json` — 5-node Node-RED flow alternative
- All served from `mastercommander.namibarden.com/collector/` and `/install.sh`

## Training Data Collection

- `llm_responses` table in PostgreSQL logs every AI query + response
- Rating via WhatsApp `/rate 1-5 [comment]` or API `POST /api/llm/rate/:id`
- Stats: `GET /api/llm/stats` — avg latency, rating, win rate per model
- Fine-tune Gemma 3n on Google Colab + Unsloth ($0) when 200-500 rated examples collected
- Training data is the real asset — portable between models

## Timezone Fix

All telemetry stored in UTC. LLM system prompt includes local time computed from GPS longitude (lon/15). `_meta.tzOffset` field included in translated snapshots.

**Why:** Gil caught AI saying "low solar at noon" — was actually 8 AM local in St. Lucia (UTC-4).
