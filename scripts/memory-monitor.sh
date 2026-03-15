#!/bin/bash
# memory-monitor.sh — Alert when Overlord container memory approaches limit
# Designed to run via cron every 5 minutes

set -euo pipefail

CONTAINER="overlord"
THRESHOLD_PCT=80
ADMIN_NUMBER="${ADMIN_NUMBER:-13055601031}"

# Get container memory usage
STATS=$(docker stats "$CONTAINER" --no-stream --format '{{.MemUsage}}' 2>/dev/null) || exit 0

# Parse "1.234GiB / 2GiB" format
USED=$(echo "$STATS" | awk -F'/' '{print $1}' | xargs)
LIMIT=$(echo "$STATS" | awk -F'/' '{print $2}' | xargs)

# Convert to MB
to_mb() {
  local val="$1"
  if echo "$val" | grep -qi 'gib'; then
    echo "$val" | sed 's/[^0-9.]//g' | awk '{printf "%.0f", $1 * 1024}'
  elif echo "$val" | grep -qi 'mib'; then
    echo "$val" | sed 's/[^0-9.]//g' | awk '{printf "%.0f", $1}'
  elif echo "$val" | grep -qi 'kib'; then
    echo "$val" | sed 's/[^0-9.]//g' | awk '{printf "%.0f", $1 / 1024}'
  else
    echo "0"
  fi
}

USED_MB=$(to_mb "$USED")
LIMIT_MB=$(to_mb "$LIMIT")

if [ "$LIMIT_MB" -eq 0 ]; then
  # No memory limit set — check host memory instead
  TOTAL_MB=$(free -m | awk '/^Mem:/{print $2}')
  USED_MB=$(free -m | awk '/^Mem:/{print $3}')
  LIMIT_MB=$TOTAL_MB
fi

PCT=$((USED_MB * 100 / LIMIT_MB))

if [ "$PCT" -ge "$THRESHOLD_PCT" ]; then
  echo "[memory-monitor] WARNING: $CONTAINER at ${PCT}% memory (${USED_MB}MB / ${LIMIT_MB}MB)"
  # Send alert via Overlord API
  WEBHOOK_TOKEN=$(grep '^WEBHOOK_TOKEN=' /root/overlord/.env 2>/dev/null | cut -d= -f2 | tr -d "'\"")
  if [ -n "$WEBHOOK_TOKEN" ]; then
    curl -sS -X POST http://localhost:3001/api/send \
      -H "Authorization: Bearer $WEBHOOK_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"to\":\"${ADMIN_NUMBER}\",\"message\":\"⚠️ Memory Alert: Overlord at ${PCT}% (${USED_MB}MB/${LIMIT_MB}MB). Stuck Claude CLI processes may be accumulating.\"}" \
      -o /dev/null --max-time 10 2>/dev/null || true
  fi
else
  echo "[memory-monitor] OK: $CONTAINER at ${PCT}% memory (${USED_MB}MB / ${LIMIT_MB}MB)"
fi
