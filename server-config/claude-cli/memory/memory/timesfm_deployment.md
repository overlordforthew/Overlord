---
name: TimesFM 2.5 Deployment
description: Google TimesFM 2.5-200m zero-shot time series forecasting service on ElmoServer, integrated with MasterCommander and HL trading bot
type: project
---

TimesFM 2.5-200m deployed on ElmoServer as a containerized FastAPI service on 2026-04-02.

**Why:** Zero-shot forecasting (no training needed) at minimal resources (200M params, ~1.5GB RAM on CPU). Chosen over Prophet (per-series fitting), Chronos (heavier), and Moirai (needs GPU). Google-backed (BigQuery feature), Apache 2.0, actively maintained.

**How to apply:** When working on MasterCommander weather/telemetry or HL trading bot grid logic, this service is available for time series predictions with confidence intervals.

## Service
- Container: `timesfm` on ElmoServer
- API: `http://100.89.16.27:8100` (Tailscale-only binding)
- Source: `/root/timesfm-service/` on ElmoServer
- CPU inference, model pre-downloaded in Docker image
- Health: `GET /health`

## API Endpoints
- `POST /forecast/telemetry` — wind, pressure, battery predictions (q10/q50/q90)
- `POST /forecast/trading` — price/volume forecasts with spread_pct for grid spacing
- `POST /forecast/batch` — multiple series in one call

## MasterCommander Integration
- `digestion/timesfm-client.js` — client module (forecastTelemetry, forecastMultiMetric, healthCheck)
- `GET /api/weather/forecast/sensor?metric=wind|pressure|battery|all&horizon=24` — pulls telemetry from PostgreSQL, feeds to TimesFM
- `GET /api/weather/forecast/sensor/health` — TimesFM availability check
- `intelligence/weather-intelligence.js` — getSensorForecast() for advisor system

## HL Trading Bot Integration
- `forecast.py` — ForecastClient with forecast_price(), get_volatility_factor()
- `blessings.py` — build_structure_grid() accepts volatility_factor (0.5x-2.0x) to scale profit/recovery/survival zone spacing
- On cold start: fetches 168 1h candles, gets TimesFM volatility factor, adjusts grid density
- Gracefully degrades if TimesFM unavailable (factor defaults to 1.0)
- Factor stored in state as `volatility_factor` for observability
