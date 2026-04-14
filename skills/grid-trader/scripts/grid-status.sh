#!/bin/bash
set -euo pipefail

# Grid Trader Status Report
# Shows current state of all Hyperliquid trading bots

PROJECT_DIR="/projects/hyperliquid-bot"
STATE_FILE="$PROJECT_DIR/data/blessings_state.json"

echo "=== HYPERLIQUID TRADING STATUS ==="
echo ""

# Container status
echo "-- Containers --"
docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | grep hl- || echo "No hl- containers running"
echo ""

# Check for OOM kills
for c in hl-blessings hl-dashboard; do
    oom=$(docker inspect "$c" --format '{{.State.OOMKilled}}' 2>/dev/null || echo "n/a")
    if [ "$oom" = "true" ]; then
        echo "WARNING: $c was OOM killed!"
    fi
done

# Blessings state
if [ -f "$STATE_FILE" ]; then
    echo "-- Blessings Bot --"
    python3 << 'PYEOF'
import json, sys
from datetime import datetime

try:
    with open("/projects/hyperliquid-bot/data/blessings_state.json") as f:
        s = json.load(f)

    cells = s.get("cells", [])
    stats = s.get("stats", {})

    waiting = sum(1 for c in cells if c["phase"] == "waiting")
    bought = sum(1 for c in cells if c["phase"] == "bought")
    tp = sum(1 for c in cells if c["phase"] == "tp_placed")
    completed = sum(1 for c in cells if c["phase"] == "completed")

    zones = {}
    for c in cells:
        z = c.get("zone", "Unknown")
        if z not in zones:
            zones[z] = {"waiting": 0, "bought": 0, "tp_placed": 0, "completed": 0}
        zones[z][c["phase"]] = zones[z].get(c["phase"], 0) + 1

    price = s.get("current_price", 0)
    ref = s.get("reference_price", 0)
    acct = s.get("account_value_at_start", 0)
    stop = s.get("stop_price", 0)
    started = s.get("started_at", "unknown")
    stopped = s.get("stopped", False)

    print(f"  BTC Price:     ${price:,.2f}")
    print(f"  Reference:     ${ref:,.2f}")
    print(f"  Account Start: ${acct:,.2f}")
    print(f"  Stop Price:    ${stop:,.2f}")
    print(f"  Started:       {started[:19]}")
    print(f"  Stopped:       {'YES - ' + s.get('stop_reason', '') if stopped else 'No'}")
    print(f"")
    print(f"  Cells: W:{waiting} B:{bought} TP:{tp} Done:{completed} / {len(cells)} total")

    for z in ["Profit", "Recovery", "Survival"]:
        if z in zones:
            d = zones[z]
            print(f"    {z:10s}: W:{d.get('waiting',0)} B:{d.get('bought',0)} TP:{d.get('tp_placed',0)} Done:{d.get('completed',0)}")

    print(f"")
    print(f"  Round-trips: {stats.get('round_trips', 0)}")
    print(f"  Total P&L:   ${stats.get('total_pnl', 0):.4f}")
    print(f"  Total Fees:  ${stats.get('total_fees', 0):.4f}")
    print(f"  Net P&L:     ${stats.get('total_pnl', 0) - stats.get('total_fees', 0):.4f}")
    print(f"  Best Trade:  ${stats.get('best_trade', 0):.4f}")
    print(f"  Worst Trade: ${stats.get('worst_trade', 0):.4f}")

    # Unrealized (cells with fills)
    filled = [c for c in cells if c.get("fill_price")]
    if filled and price > 0:
        unrealized = sum((price - c["fill_price"]) * c.get("size_btc", 0) for c in filled)
        print(f"  Unrealized:  ${unrealized:.4f}")

    last = s.get("last_check", "")
    if last:
        print(f"")
        print(f"  Last Check:  {last[:19]}")

except Exception as e:
    print(f"  Error reading state: {e}", file=sys.stderr)
    sys.exit(1)
PYEOF
else
    echo "  No Blessings state file found"
fi

echo ""

# Recent log activity
echo "-- Recent Log (last 5 lines) --"
docker logs hl-blessings --tail 5 2>/dev/null || echo "  Container not running"

echo ""

# Weight usage from logs
echo "-- API Weight Usage --"
docker logs hl-blessings --tail 20 2>/dev/null | grep -oP 'Wt:\K[0-9]+/[0-9]+' | tail -1 || echo "  No weight data"

echo ""
echo "=== END STATUS ==="
