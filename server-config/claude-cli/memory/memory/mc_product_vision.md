---
name: mc-product-vision
description: MasterCommander product direction — universal marine monitoring, not Gil's-boat-only. 6 protocol families, LLM discovery, RPi minimum.
type: project
---

# MasterCommander Product Vision

**Decided**: 2026-04-05 (discussion between Gil and Overlord)

## Core Thesis
MasterCommander is evolving from Gil's personal boat monitoring tool to a **universal, hardware-agnostic marine monitoring product**. The moat is the intelligent self-configuring collector, not the dashboard.

## Gil's Boat (Reference Setup)
- Cerbo GX: 192.168.1.177 (MQTT on 127.0.0.1 from Cerbo's perspective)
- Zeus 3: 192.168.1.124 (GoFree WS :2053, NMEA TCP :10110)
- **No NMEA 2000 cable** — this means MQTT only gets Victron data; GoFree required for nav/engines/tanks
- Sentinel collector LIVE on Cerbo at `/data/mc-sentinel/`, auto-restart, pushing every 10s

## Data Source Priority Chain (agreed)
1. **MQTT (Cerbo)** — PRIMARY. Victron always; full NMEA 2000 if $50 VE.Can cable installed
2. **SignalK** — UNIVERSAL ALTERNATIVE. Open standard, runs on RPi/any Linux, brand-agnostic
3. **GoFree WS** — NAVICO-SPECIFIC BONUS. Only works with B&G/Simrad/Lowrance plotters
4. **NMEA 0183 TCP** — LEGACY FALLBACK. Raymarine Axiom, older MFDs, Yacht Devices gateways
5. **Cloud APIs** — OFFLINE FALLBACK. VRM (Victron), YachtSense (Raymarine)
6. **BLE** — BATTERY MONITORS. Simarine PICO, Victron SmartShunt

**Why:** GoFree is Navico-only. Raymarine/Garmin are more closed. The NMEA 2000 cable ($50) makes MQTT universal regardless of plotter brand. SignalK covers the RPi/DIY crowd.

## Killer Feature: LLM-Driven Auto-Discovery
During install, the collector:
1. Network scans (mDNS, port probe, ARP/MAC lookup)
2. Local LLM classifies devices from scan results
3. Runs all discovered adapters for 30s, catalogs every data point
4. Builds a dynamic source_map routing each point to the best source
5. Generates human-readable setup summary + config

**How to apply:** When building collector features, always consider all 6 protocol families. Never hardcode adapter assumptions. The install wizard should be LLM-driven, not manual config.

## Minimum Viable Hardware
A Raspberry Pi ($50) can run Venus OS (becomes a Cerbo), SignalK, OpenPlotter, or just the collector script. This is the cheapest entry point for boats without Victron hardware.

## Key Plotter Landscape
| Brand | Open API | Best Adapter |
|-------|----------|-------------|
| B&G/Simrad/Lowrance (Navico) | GoFree WebSocket | GoFree adapter |
| Raymarine | NMEA 0183 TCP (limited) | NMEA TCP adapter |
| Garmin | Mostly closed | Needs gateway (RPi + SignalK) |
| Furuno | Minimal | Needs gateway |
