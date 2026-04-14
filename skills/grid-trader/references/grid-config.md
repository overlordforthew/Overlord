# Grid Trader Configuration Reference

## Environment Variables

### Required (Secrets)

| Variable | Description | Example |
|----------|-------------|---------|
| `HL_AGENT_PRIVATE_KEY` | Hyperliquid agent wallet private key | `0x...` |
| `HL_MAIN_ADDRESS` | Main account address (the agent trades on behalf of) | `0x4a75...` |
| `HL_DASHBOARD_API_KEY` | API key for dashboard authentication | `1N9c...` |

### Grid Bot Parameters

| Variable | Default | Description |
|----------|---------|-------------|
| `HL_GRID_COIN` | `BTC` | Trading pair (BTC, ETH, SOL, XRP, DOGE, etc.) |
| `HL_GRID_SPACING_PCT` | `0.3` | Grid level spacing as % of price. Wider = fewer trades but more profit per trade |
| `HL_GRID_LEVELS` | `5` | Number of grid levels per side (5 buy + 5 sell = 10 total orders) |
| `HL_GRID_ORDER_SIZE_USD` | `10.5` | Order size in USD. Must be >= $10.50 to avoid min order rejections |
| `HL_GRID_CHECK_INTERVAL` | `30` | Seconds between status checks. Lower = faster fills detected but more API weight |
| `HL_GRID_STOP_LOSS_PCT` | `10` | Stop-loss as % of account value. Triggers full position close |
| `HL_GRID_START_DELAY` | `0` | Seconds to wait before starting. Used to stagger multi-coin bots |

### Mode Switches

| Variable | Default | Description |
|----------|---------|-------------|
| `HL_DRY_RUN` | `1` | `1` = simulate only (log actions, no real orders). `0` = LIVE trading |
| `HL_TESTNET` | `0` | `0` = mainnet. `1` = Hyperliquid testnet |

## State File Format

Location: `/projects/hyperliquid-bot/data/{bot}_state_{coin}.json`

```json
{
  "coin": "BTC",
  "reference_price": 74154.5,
  "grid_spacing_pct": 0.5,
  "num_levels": 5,
  "order_size_usd": 20,
  "tick": 0.1,
  "sz_decimals": 8,
  "started_at": "2026-03-01T10:00:00Z",
  "initialized": true,
  "cells": [
    {
      "id": "B1",
      "low": 73734.0,
      "high": 74089.0,
      "size": 0.00127,
      "phase": "buy|sell|buy_tp|sell_tp",
      "oid": 353063462514,
      "entry_price": 74154.0,
      "entry_fee": 0.014126
    }
  ],
  "trades": [
    {
      "cell": "B1",
      "side": "LONG",
      "entry": 74154.0,
      "exit": 74525.0,
      "size": 0.00127,
      "pnl": 0.4711,
      "fee": 0.0282,
      "time": "2026-03-01T12:30:00Z"
    }
  ],
  "total_pnl": 0.0,
  "total_fees": 0.0,
  "account_value_at_start": 9423.36,
  "stop_loss_pct": 10,
  "stopped": false,
  "stop_reason": "",
  "stopped_at": ""
}
```

### Cell Phases

| Phase | Meaning |
|-------|---------|
| `buy` | Waiting for buy order to fill |
| `sell_tp` | Buy filled, take-profit sell order placed |
| `sell` | Waiting for sell (short) order to fill |
| `buy_tp` | Sell filled, take-profit buy order placed |

## Blessings v2 Bot Config

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BLESS_LEVERAGE` | `3` | Cross margin leverage |
| `BLESS_LIQ_TARGET` | `37999` | Target liquidation price after funding horizon |
| `BLESS_SAFETY_BUFFER` | `2000` | Auto-close if liq price within this $ of lowest entry |
| `BLESS_FUNDING_RATE` | `0.0001` | Funding rate per 8h period (0.01%) |
| `BLESS_FUNDING_HORIZON` | `18` | Months of funding to budget for in sizing |
| `BLESS_STOP_PRICE` | `38000` | Hard stop-loss price |
| `BLESS_BASKET_TP_PCT` | `0.5` | TP target above VWAP for Recovery/Survival zones |
| `BLESS_PROFIT_LEVELS` | `15` | Number of levels in profit zone |
| `BLESS_CHECK_INTERVAL` | `15` | Seconds between main loop checks |

### Zone Structure

| Zone | Levels | Spacing | Martingale | Weight |
|------|--------|---------|------------|--------|
| Profit | 15 | Uniform (lower_high → lower_low) | None | 1.0x |
| Recovery | 10 | $675 fixed | 1.1x compound | 1.1x → 2.6x |
| Survival | 12 | $1,958 fixed | 1.3x compound | 3.4x → 60x |

### Sizing

Uses `solve_base_usd_for_liq_target()` — binary search for base_usd per weight unit such that with all levels filled and 18 months of funding costs, liquidation price = $37,999.

Order notional = `base_usd × weight × leverage`. Unified account: spot USDC is perps margin.

### State Fields (v2 additions)

| Field | Description |
|-------|-------------|
| `leverage` | Active leverage setting |
| `liq_target` | Target liquidation price |
| `liq_price` | Current calculated liquidation price |
| `liq_buffer` | Distance from lowest entry to liq price ($) |
| `est_funding_paid` | Estimated cumulative funding cost ($) |

## Rate Limit Budget

Shared across all bots on the same IP:

| Endpoint Type | Weight Cost |
|---------------|-------------|
| Light reads (l2Book, allMids) | 2 |
| Standard reads (meta, openOrders, userFills) | 20 |
| Exchange ops (order, cancel) | 1 + floor(batch/40) |
| **Total budget** | **1200 / minute** |

With 5 grid bots at 30s intervals: ~5 x 2 x (2 + 20 + 1) = 230 weight/min. Safe.
With blessings + dashboard added: ~330 weight/min. Still safe.
Danger zone: >800 weight/min sustained.

## Docker Compose Reference

### Active (docker-compose.yml)
```yaml
services:
  blessings:
    container_name: hl-blessings
    command: ["python", "-u", "blessings.py"]
    mem_limit: 256m
    restart: unless-stopped

  dashboard:
    container_name: hl-dashboard
    command: ["python", "-u", "dashboard.py"]
    mem_limit: 256m
    networks: [default, coolify]
```

### Disabled (docker-compose.old.yml)
```yaml
services:
  hl-grid-btc:
    container_name: hl-grid-btc
    command: ["python", "-u", "grid_bot.py"]
    environment:
      HL_GRID_COIN: BTC
      HL_GRID_START_DELAY: 0
    mem_limit: 128m
  # ... same pattern for ETH, SOL, XRP, DOGE with staggered delays
```
