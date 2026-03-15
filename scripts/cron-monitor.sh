#!/bin/bash
# Cron Health Monitor — checks heartbeat files for stale crons
# Each cron job writes its timestamp to /root/overlord/data/cron-heartbeats/<job-name>
# This script checks each against expected intervals (with 50% grace)

# Use /app/data inside container, /root/overlord/data on host
if [ -d "/app/data" ]; then
  HEARTBEAT_DIR="/app/data/cron-heartbeats"
else
  HEARTBEAT_DIR="/root/overlord/data/cron-heartbeats"
fi
NOW=$(date +%s)
STALE_JOBS=""

# job-name → expected-interval-seconds
declare -A JOBS
JOBS[health-check]=21600       # 6h
JOBS[backup]=86400             # 24h
JOBS[morning-brief]=86400     # 24h
JOBS[auto-journal]=86400      # 24h
JOBS[daily-briefing]=86400    # 24h (scheduler internal)
JOBS[url-monitor]=1350        # 15min + 50% grace
JOBS[log-monitor]=450         # 5min + 50% grace
JOBS[heartbeat]=10800         # 2h + 50% grace
JOBS[session-guard]=90        # 1min + 50% grace
JOBS[nightly-synthesis]=86400 # 24h

for JOB in "${!JOBS[@]}"; do
  FILE="$HEARTBEAT_DIR/$JOB"
  INTERVAL=${JOBS[$JOB]}
  GRACE=$(( INTERVAL + INTERVAL / 2 ))

  if [ ! -f "$FILE" ]; then
    # No heartbeat file yet — skip (job hasn't run since monitor was set up)
    continue
  fi

  LAST=$(cat "$FILE" 2>/dev/null)
  if [ -z "$LAST" ]; then continue; fi

  AGE=$(( NOW - LAST ))
  if [ "$AGE" -gt "$GRACE" ]; then
    HOURS=$(( AGE / 3600 ))
    MINS=$(( (AGE % 3600) / 60 ))
    STALE_JOBS="$STALE_JOBS\n- $JOB: last ran ${HOURS}h ${MINS}m ago (expected every $((INTERVAL/60))m)"
  fi
done

if [ -n "$STALE_JOBS" ]; then
  echo -e "STALE:$STALE_JOBS"
  exit 1
else
  echo "OK"
  exit 0
fi
