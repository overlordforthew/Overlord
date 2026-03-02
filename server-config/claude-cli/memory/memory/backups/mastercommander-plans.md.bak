# MasterCommander — Future Plans & Design Notes

## Boat Change Detection (TODO — plan later)
**Date noted:** 2026-02-25
**Priority:** Plan before building

### Problem
When a fleet user changes boats (or a surveyor/delivery captain moves between boats), the system needs to detect the boat has changed upon cloud connection. Key scenarios:
- Fleet user reassigns a Commander unit to a different boat
- Surveyor uses portable Diagnostic Scanner on multiple boats (only Commander mode, may never connect to cloud)
- Delivery captain uses Delivery Puck across deliveries (same issue)

### Constraints
- Commander App works offline (ON BOARD tier) — can't enforce cloud check there
- Detection must happen when connecting to Master Cloud (REMOTE/MASTER tier)
- Surveyors and delivery captains may operate exclusively in Commander mode (no cloud)

### Key Question
How do we catch a surveyor or delivery captain using the device on multiple boats if they only use Commander mode (never connects to cloud)?

### Ideas to Explore
- **Hardware fingerprinting:** Commander reads boat's NMEA2000 network — each boat has unique device signatures (engine serial, GPS unit ID, etc.). Store a "boat fingerprint" locally on Commander. If fingerprint changes, flag it.
- **SignalK vessel identity:** SignalK has `self` identity with MMSI, vessel name, etc. If these change, Commander knows it's a new boat.
- **Cloud sync on next connection:** Even if offline for a while, when Commander eventually connects to cloud, send the boat fingerprint history. Cloud detects mismatches.
- **All actors need "new boat assessment":** Every user type (fleet, private, surveyor, delivery) should go through a boat verification flow when cloud connection is established.
- **Offline enforcement option:** Commander App could require boat confirmation at startup if it detects a fingerprint mismatch, even without cloud. This handles the "never connects to cloud" case.
- **Billing/licensing tie-in:** Each Commander license could be tied to a specific boat fingerprint. Moving it requires explicit transfer (prevents license abuse).
