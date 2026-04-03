---
name: MasterCommander TimesFM Integration
description: MasterCommander has zero-shot sensor forecasting (wind, pressure, battery) via TimesFM 2.5 on ElmoServer
type: project
---

MasterCommander can forecast its own sensor data using TimesFM 2.5 (200M param, zero-shot). Added 2026-04-02.

**Why:** Supplements Open-Meteo weather API forecasts with predictions derived from the boat's own sensors. Wind speed, barometric pressure, and battery voltage predictions with confidence intervals (q10/q50/q90). Zero-shot means no training — just pipe in historical values and get forecasts.

**How to apply:** When working on MasterCommander weather intelligence, advisor recommendations, or dashboard features, this capability is live and available.

## Files
- `digestion/timesfm-client.js` — client module: `forecastTelemetry()`, `forecastMultiMetric()`, `healthCheck()`
- `digestion/weather-service.js` — endpoint `GET /api/weather/forecast/sensor?metric=wind|pressure|battery|all&horizon=24&history=360`
- `digestion/weather-service.js` — health check `GET /api/weather/forecast/sensor/health`
- `digestion/intelligence/weather-intelligence.js` — `getSensorForecast(horizon)` method feeds sensor history into TimesFM for the advisor layer

## How It Works
1. Pulls historical telemetry from PostgreSQL (`boat_telemetry` table, JSONB snapshots)
2. Thins to ~1 reading per minute
3. Sends to TimesFM API at `http://100.89.16.27:8100/forecast/telemetry` (or `/batch` for multi-metric)
4. Returns point forecast + q10/q50/q90 confidence bands
5. Sensor forecast cached 15 min in weather-intelligence, API cache is 30 min LRU

## Config
- `TIMESFM_URL` env var (default: `http://100.89.16.27:8100`)
- Gracefully degrades if TimesFM is down — returns null, no crashes
