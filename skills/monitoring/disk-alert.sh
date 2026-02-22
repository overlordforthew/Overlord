#!/bin/bash
# disk-alert.sh — Check disk and memory, warn if thresholds exceeded
set -euo pipefail

THRESHOLD=${1:-80}

echo "=== Disk & Memory Check (threshold: ${THRESHOLD}%) ==="

# Disk check
DISK_PCT=$(df -h / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_PCT" -ge "$THRESHOLD" ]; then
    echo "ALERT: Disk usage at ${DISK_PCT}% (threshold: ${THRESHOLD}%)"
    echo "  Top space consumers:"
    du -sh /var/log/* /root/* /data/* 2>/dev/null | sort -rh | head -5
else
    echo "OK: Disk at ${DISK_PCT}%"
fi

# Memory check
MEM_TOTAL=$(free | awk '/Mem/{print $2}')
MEM_USED=$(free | awk '/Mem/{print $3}')
MEM_PCT=$((MEM_USED * 100 / MEM_TOTAL))
if [ "$MEM_PCT" -ge "$THRESHOLD" ]; then
    echo "ALERT: Memory usage at ${MEM_PCT}% (threshold: ${THRESHOLD}%)"
    echo "  Top memory consumers:"
    docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}' 2>/dev/null | head -6
else
    echo "OK: Memory at ${MEM_PCT}%"
fi

# Swap check
SWAP_TOTAL=$(free | awk '/Swap/{print $2}')
if [ "$SWAP_TOTAL" -gt 0 ]; then
    SWAP_USED=$(free | awk '/Swap/{print $3}')
    SWAP_PCT=$((SWAP_USED * 100 / SWAP_TOTAL))
    if [ "$SWAP_PCT" -ge 50 ]; then
        echo "WARNING: Swap usage at ${SWAP_PCT}% — system may be under memory pressure"
    else
        echo "OK: Swap at ${SWAP_PCT}%"
    fi
fi
