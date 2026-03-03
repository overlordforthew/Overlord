# MasterCommander — Future Plans & Design Notes

## Boat Change Detection (TODO — plan later)
**Date noted:** 2026-02-25
**Priority:** Plan before building

### Problem
Detect boat changes upon cloud connection. Key scenarios:
- Fleet user reassigns Commander to a different boat
- Surveyor uses Diagnostic Scanner on multiple boats (Commander mode, may not connect to cloud)
- Delivery captain uses Delivery Puck across deliveries

### Constraints
- Commander App works offline.
- Detection must happen on Master Cloud connection.
- Surveyors/delivery captains may use Commander mode (no cloud).

### Key Question
How to detect surveyors/delivery captains using devices on multiple boats without cloud connection?

### Ideas to Explore
- Hardware fingerprinting: Commander reads NMEA2000 network — each boat has unique device signatures (engine serial, GPS unit ID, etc.). Store boat fingerprint locally. Flag changes.
- SignalK vessel identity: SignalK `self` identity (MMSI, vessel name) changes indicate a new boat.
- Cloud sync on next connection: Send boat fingerprint history upon connection, even offline. Cloud detects mismatches.
- All users require "new boat assessment" on cloud connection.
- Offline enforcement: Commander App requires boat confirmation at startup if fingerprint mismatch is detected.
- Billing/licensing tie-in: Commander license tied to a specific boat fingerprint. Transfer requires explicit action.
