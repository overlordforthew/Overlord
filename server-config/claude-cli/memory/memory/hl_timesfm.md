---
name: Hyperliquid Bot TimesFM Integration
description: Blessings grid bot uses TimesFM 2.5 volatility forecasts to dynamically adjust grid spacing
type: project
---

Blessings grid bot integrates TimesFM 2.5 for forecast-driven grid spacing. Added 2026-04-02.

**Why:** Static grid spacing ignores market regime. TimesFM's quantile forecasts (q10/q90 spread) provide a volatility signal: tight spread = calm market = compress grid for more fills; wide spread = volatile = widen grid to reduce drawdown risk.

**How to apply:** When modifying grid construction, spacing logic, or adding new grid parameters, be aware that spacing is now scaled by a TimesFM-derived volatility factor.

## Files
- `forecast.py` — `ForecastClient` class: `forecast_price()`, `forecast_with_volume()`, `get_volatility_factor()`, `health()`
- `blessings.py` — `build_structure_grid()` accepts `volatility_factor` param (default 1.0)

## How It Works
1. On cold start (new grid build), fetches 168 hourly candles (7 days)
2. Sends closing prices to TimesFM `/forecast/trading` endpoint
3. Gets back spread_pct (q90-q10 as % of forecast) per horizon step
4. Averages spread_pct, compares to 2% baseline → volatility_factor (clamped 0.5x-2.0x)
5. All three zones (Profit, Recovery, Survival) scale spacing by this factor
6. Factor stored in `state["volatility_factor"]` for dashboard observability

## Behavior
- Factor < 1.0: tighter grid (more levels, more fills in calm markets)
- Factor = 1.0: default spacing (TimesFM unavailable or normal volatility)
- Factor > 1.0: wider grid (fewer fills but less drawdown in volatile markets)
- Graceful degradation: if TimesFM is down, factor = 1.0, grid builds normally

## Config
- `TIMESFM_URL` env var (default: `http://100.89.16.27:8100`)
- 5-minute forecast cache in ForecastClient
- Only runs on cold start (grid rebuild), not on warm resume
