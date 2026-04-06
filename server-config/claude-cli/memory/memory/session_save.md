---
name: session-save
description: MC Sentinel LIVE on Cerbo GX. Universal collector architecture spec underway. Server pruned to 78% disk.
type: project
---

# Session Save
**Saved**: 2026-04-05 ~13:00 UTC
**Project**: MasterCommander + Server maintenance
**Branch**: main (clean — all pushed)
**State**: working

## Current Production State
- **Sentinel is LIVE on Cerbo GX** at `/data/mc-sentinel/`
- Auto-restart via `/data/mc-sentinel/run.sh` (while-true loop, 5s backoff)
- Boot autostart via `/data/rc.local`
- All 3 adapters connected: MQTT (Victron), GoFree (Zeus), NMEA TCP (Zeus)
- Pushing to mastercommander.namibarden.com every 10s
- Old collector (`/data/mc-collector/`) retired

## What Was Decided This Session

### Universal Collector Architecture
Gil directed MC from personal tool to universal product:
- 6 protocol families: MQTT, SignalK, GoFree, NMEA TCP, Cloud APIs, BLE
- Pluggable adapter architecture with auto-discovery
- LLM-driven install wizard (network scan → device ID → source mapping)
- RPi as minimum viable hardware
- See `mc_product_vision.md` for full details

### Server Prune (2026-04-05)
- Disk 93% → 78% (5.1GB → 16GB free)
- Cleaned: dangling Docker images (~4.9GB), build cache (~3.1GB), npm cache (~2.1GB), apt cache (~566MB), old Claude Code versions (~440MB), stale puppeteer profiles, journal logs

## Next Steps
1. **Spec the universal collector** — COLLECTOR-SPEC.md v0.3 with 6 adapters, discovery engine, source map
2. **Phase 2: Discovery Engine** — network scanning, device signatures
3. **Phase 3: Commander-guided install** — LLM wizard via phone tunnel
4. **Phase 0: Commander Direct Mode** — GoFree + NMEA TCP in React Native app
5. **Phase 4: SignalK adapter** — unlocks non-Victron boats

## Errors / Blockers
None. Sentinel is live and stable.
