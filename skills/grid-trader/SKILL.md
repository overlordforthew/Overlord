---
name: grid-trader
description: "Manage Hyperliquid grid trading bots — status, restart, adjust params, debug, P&L. Use when user says 'grid', 'grid bot', 'blessings', 'hyperliquid', 'trading bot', 'hl bot', 'grid status', 'P&L', 'trading', or mentions any grid/trading operation."
allowed-tools:
  - Bash(docker:*)
  - Bash(bash:*)
  - Bash(python:*)
  - Bash(cat:*)
  - Bash(jq:*)
  - Read
  - Edit
  - Grep
  - Glob
compatibility: "Hetzner server. Docker + docker-compose at /projects/hyperliquid-bot/. Hyperliquid Python SDK. Flask dashboard on port 5555."
metadata:
  author: Gil Barden / Overlord
  version: "2026-03-20"
---

# Grid Trader — Hyperliquid Bot Operations

Manage Gil's Hyperliquid trading infrastructure: grid bots, Blessings martingale bot, market maker, and the monitoring dashboard.

## BEFORE YOU START — Read gotchas.md

Read `gotchas.md` in this skill folder. It contains failure-derived lessons from production incidents.

## Architecture

```
/projects/hyperliquid-bot/
├── grid_bot.py        # Symmetric grid bot (BUY/SELL levels around mid price)
├── blessings.py       # Martingale grid bot (long-only, 3 zones, VWAP TP)
├── market_maker.py    # Spread-capture market maker (ALO orders)
├── hl_client.py       # Rate-limit-aware API client (singleton, 1200 weight/min)
├── dashboard.py       # Flask web UI on port 5555
├── data/              # State files (JSON per bot/coin)
├── logs/              # Log files per bot
└── docker-compose.yml # Active: hl-blessings + hl-dashboard
```

**Active containers:** `hl-blessings`, `hl-dashboard`
**Disabled containers:** `hl-grid-btc`, `hl-grid-eth`, `hl-grid-sol`, `hl-grid-xrp`, `hl-grid-doge` (in docker-compose.old.yml)

## Helper Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `grid-status.sh` | Full status: containers, state, P&L, open orders | `bash scripts/grid-status.sh` |
| `grid-restart.sh` | Safe restart with state backup | `bash scripts/grid-restart.sh [service]` |
| `grid-adjust.sh` | Modify grid params via env vars | `bash scripts/grid-adjust.sh [param] [value]` |
| `grid-logs.sh` | Tail/search logs with filtering | `bash scripts/grid-logs.sh [service] [lines]` |

## Common Operations

### Check Status
```bash
bash /projects/.claude/skills/grid-trader/scripts/grid-status.sh
```
Shows: running containers, memory usage, state file summary (P&L, open cells, trades count), last log lines.

### Restart a Bot
```bash
# Restart blessings (active bot)
bash /projects/.claude/skills/grid-trader/scripts/grid-restart.sh blessings

# Restart specific grid bot (if re-enabled)
bash /projects/.claude/skills/grid-trader/scripts/grid-restart.sh grid-btc
```
Always backs up state before restart. Verifies container comes back healthy.

### Adjust Parameters
```bash
# Change grid spacing
bash /projects/.claude/skills/grid-trader/scripts/grid-adjust.sh HL_GRID_SPACING_PCT 0.5

# Change order size
bash /projects/.claude/skills/grid-trader/scripts/grid-adjust.sh HL_GRID_ORDER_SIZE_USD 25

# Toggle dry run
bash /projects/.claude/skills/grid-trader/scripts/grid-adjust.sh HL_DRY_RUN 0
```
Edits .env, restarts affected container, verifies new params loaded.

### View Logs
```bash
# Last 50 lines from blessings
bash /projects/.claude/skills/grid-trader/scripts/grid-logs.sh blessings 50

# Search for errors
bash /projects/.claude/skills/grid-trader/scripts/grid-logs.sh blessings 200 ERROR
```

### Enable/Disable Grid Bots
To re-enable the multi-coin grid bots:
1. Copy desired services from `docker-compose.old.yml` into `docker-compose.yml`
2. Ensure `.env` has the right params (check `references/grid-config.md`)
3. Run `docker compose -f /projects/hyperliquid-bot/docker-compose.yml up -d`
4. Monitor logs for first 2 minutes — watch for ALO rejections or rate limit hits

### Debug a Stuck Bot
1. Check container status: `docker ps -a | grep hl-`
2. Check logs: `bash scripts/grid-logs.sh [service] 100 ERROR`
3. Check state file: `cat /projects/hyperliquid-bot/data/[state_file].json | jq .`
4. Look for: `stopped: true`, stale `phase` values, missing `oid` fields
5. If state is corrupted: backup current state, delete state file, restart (bot re-initializes)

### Monitor P&L
Read the state file directly:
```bash
jq '{total_pnl, total_fees, net: (.total_pnl - .total_fees), trades_count: (.trades | length), stopped, stop_reason}' /projects/hyperliquid-bot/data/blessings_state.json
```

## Bot Strategies

### Grid Bot (grid_bot.py)
- Symmetric grid: N buy levels below mid, N sell levels above
- Each cell cycles: place order → fill → place take-profit → fill → profit booked
- P&L = (exit - entry) x size - fees
- Stop-loss: triggers if (realized + unrealized PnL) <= -(account_value x stop_loss_pct%)

### Blessings v2 (blessings.py)
- Long-only martingale with 3 zones, **3x cross leverage**:
  - Profit zone: 15 levels, uniform $-spacing from lower-high → lower-low, 1.0x weight
  - Recovery zone: 10 levels, $675 fixed spacing, 1.1x martingale
  - Survival zone: 12 levels, $1,958 fixed spacing, 1.3x martingale
- **Liquidation-safe sizing**: binary search for base_usd so liq = $37,999 after 18mo of funding (0.01%/8h)
- **Unified account**: spot USDC is perps margin (no transfer needed)
- Take-profit: Profit zone uses structure TP (swing high), Recovery/Survival use basket VWAP + 0.5%
- **Safety valve**: auto-close all if liq price creeps within $2,000 of lowest filled entry
- Funding cost tracking in state (`est_funding_paid`, `liq_price`, `liq_buffer`)

### Market Maker (market_maker.py)
- Quotes both sides of the book
- ALO (post-only) orders to collect maker rebates
- Currently disabled

## Safety Rules

- NEVER edit `.env` directly — use `grid-adjust.sh` which creates backups
- NEVER delete state files without backing up first
- NEVER restart during active order placement (check logs for "placing" messages)
- ALWAYS verify container health after restart (logs + docker ps)
- DRY_RUN=1 by default — confirm with Gil before switching to live (DRY_RUN=0)
- Stop-loss exists but verify `account_value_at_start` is current after deposits/withdrawals
- Rate limit budget: 1200 weight/min shared across ALL bots on same IP

## References

See `references/grid-config.md` for complete environment variable documentation.
