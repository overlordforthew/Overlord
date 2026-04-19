#!/bin/bash
# Cron Health Monitor — verifies every crontab entry actually works.
#
# Three checks per entry:
#   1. EXISTS  — script/binary exists on disk
#   2. RUNNABLE — file is executable (or interpreter exists for "bash/node/python3" prefixed)
#   3. HEARTBEAT — if a heartbeat file exists, is it stale?
#
# Usage:
#   cron-monitor.sh          # Human-readable report
#   cron-monitor.sh --json   # Machine-readable JSON
#   cron-monitor.sh --brief  # One-liner summary
#   cron-monitor.sh --alert  # Scheduler-friendly OK:/STALE: output

# No set -e — grep returns 1 on no match which kills pipelines

JSON_MODE=false
BRIEF_MODE=false
ALERT_MODE=false
for arg in "$@"; do
  case "$arg" in
    --json) JSON_MODE=true ;;
    --brief) BRIEF_MODE=true ;;
    --alert) ALERT_MODE=true ;;
  esac
done

HEARTBEAT_DIR="/root/overlord/data/cron-heartbeats"
NOW=$(date +%s)
GENERATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Known heartbeat intervals (seconds) for jobs that write heartbeat files
declare -A HEARTBEAT_INTERVALS
HEARTBEAT_INTERVALS[health-check]=21600       # 6h
HEARTBEAT_INTERVALS[backup]=86400             # 24h
HEARTBEAT_INTERVALS[morning-brief]=86400      # 24h
HEARTBEAT_INTERVALS[auto-journal]=86400       # 24h
HEARTBEAT_INTERVALS[session-briefing]=1800    # 30min
HEARTBEAT_INTERVALS[memory-monitor]=300       # 5min

# Entries to skip verification (inline commands, docker exec, etc.)
is_inline_command() {
  local cmd="$1"
  # find/docker exec/claude auth are inline — no single script to check
  [[ "$cmd" == find\ * ]] && return 0
  [[ "$cmd" == docker\ exec\ * ]] && return 0
  [[ "$cmd" == /usr/bin/claude\ * ]] && return 0
  return 1
}

uses_interpreter() {
  local cmd="$1"
  echo "$cmd" | grep -qP '(^|[[:space:];]|&& )((/usr/bin/)?(bash|node|python3)) '
}

# Extract the script path from a cron command
# Handles: "bash script.sh", "node script.js", "python3 script.py",
#           "cd /dir && node script.js", plain "/path/to/script"
extract_script_path() {
  local cmd="$1"

  # Handle "cd /dir && cmd" — take the part after &&
  if [[ "$cmd" == *" && "* ]]; then
    local dir=$(echo "$cmd" | sed 's/cd \([^ ]*\) &&.*/\1/')
    local rest=$(echo "$cmd" | sed 's/.*&& *//')
    # Resolve relative path
    local script=$(echo "$rest" | awk '{print $NF}' | sed 's/ *>>.*//')
    script=$(echo "$rest" | grep -oP '(?:bash |node |python3 )?\K[^ ]+\.(sh|js|mjs|py)' | head -1)
    if [[ -n "$script" && "$script" != /* ]]; then
      script="$dir/$script"
    fi
    echo "$script"
    return
  fi

  # Handle "interpreter script args >> log"
  local script=$(echo "$cmd" | grep -oP '(?:bash |node |python3 )?(\K/[^ ]+\.(sh|js|mjs|py))' | head -1)
  if [[ -n "$script" ]]; then
    echo "$script"
    return
  fi

  # Plain path — first token that looks like a path
  local first=$(echo "$cmd" | awk '{print $1}')
  if [[ "$first" == /* ]]; then
    echo "$first"
    return
  fi

  # Second token (after bash/node/python3)
  local second=$(echo "$cmd" | awk '{print $2}')
  if [[ "$second" == /* ]]; then
    echo "$second"
    return
  fi

  echo ""
}

# Extract a short name from the script path for heartbeat lookup
script_to_name() {
  local path="$1"
  basename "$path" | sed 's/\.\(sh\|js\|mjs\|py\)$//'
}

# Approximate the expected run interval from the cron schedule.
# This is only used to decide whether a log file is fresh enough to inspect.
estimate_schedule_interval() {
  local schedule="$1"
  local minute hour day month dow
  read -r minute hour day month dow <<< "$schedule"

  if [[ "$minute" =~ ^\*/([0-9]+)$ ]]; then
    echo $((BASH_REMATCH[1] * 60))
    return
  fi

  if [[ "$hour" =~ ^\*/([0-9]+)$ ]]; then
    echo $((BASH_REMATCH[1] * 3600))
    return
  fi

  if [[ "$dow" != "*" ]]; then
    echo 604800
    return
  fi

  echo 86400
}

# Parse crontab
ENTRIES=()
SCHEDULES=()
COMMANDS=()

while IFS= read -r line; do
  # Skip comments and blanks
  [[ "$line" =~ ^# ]] && continue
  [[ -z "$line" ]] && continue

  # Extract schedule (first 5 fields) and command (rest)
  schedule=$(echo "$line" | awk '{print $1, $2, $3, $4, $5}')
  command=$(echo "$line" | awk '{for(i=6;i<=NF;i++) printf "%s ", $i; print ""}' | sed 's/ *$//')

  ENTRIES+=("$line")
  SCHEDULES+=("$schedule")
  COMMANDS+=("$command")
done < <(crontab -l 2>/dev/null)

TOTAL=${#ENTRIES[@]}
OK=0
WARN=0
FAIL=0
SKIP=0

PROBLEMS=()
WARNINGS=()
DETAILS=()

for i in "${!COMMANDS[@]}"; do
  cmd="${COMMANDS[$i]}"
  sched="${SCHEDULES[$i]}"

  # Skip inline commands
  if is_inline_command "$cmd"; then
    SKIP=$((SKIP + 1))
    DETAILS+=("SKIP  | $sched | (inline command)")
    continue
  fi

  script=$(extract_script_path "$cmd")

  if [[ -z "$script" ]]; then
    SKIP=$((SKIP + 1))
    DETAILS+=("SKIP  | $sched | (could not parse: ${cmd:0:60})")
    continue
  fi

  name=$(script_to_name "$script")
  status="OK"
  notes=""
  heartbeat_fresh=false

  # Check 1: Does the script exist?
  if [[ ! -f "$script" ]]; then
    status="FAIL"
    notes="script not found: $script"
    FAIL=$((FAIL + 1))
    PROBLEMS+=("$name: $notes")
    DETAILS+=("$status | $sched | $name — $notes")
    continue
  fi

  # Check 2: Is it executable (or called via interpreter)?
  if [[ ! -x "$script" ]]; then
    if uses_interpreter "$cmd"; then
      : # Fine — interpreter handles it
    else
      status="WARN"
      notes="not executable (chmod +x needed)"
      WARN=$((WARN + 1))
      WARNINGS+=("$name: $notes")
      DETAILS+=("$status | $sched | $name — $notes")
      continue
    fi
  fi

  # Check 3: Heartbeat freshness (if applicable)
  hb_file="$HEARTBEAT_DIR/$name"
  if [[ -f "$hb_file" ]]; then
    interval=${HEARTBEAT_INTERVALS[$name]:-0}
    if [[ "$interval" -gt 0 ]]; then
      last=$(cat "$hb_file" 2>/dev/null)
      if [[ "$last" =~ ^[0-9]+$ ]]; then
        age=$((NOW - last))
        grace=$((interval + interval / 2))
        if [[ "$age" -gt "$grace" ]]; then
          hours=$((age / 3600))
          mins=$(( (age % 3600) / 60 ))
          status="WARN"
          notes="heartbeat stale: ${hours}h${mins}m ago (expected every $((interval/60))m)"
          WARN=$((WARN + 1))
          WARNINGS+=("$name: $notes")
          DETAILS+=("$status | $sched | $name — $notes")
          continue
        fi
        heartbeat_fresh=true
      fi
    fi
  fi

  # Check 4: If script has a log file, check for recent errors
  log_file=$(echo "$cmd" | grep -oP '>> *\K[^ ]+' | head -1)
  if [[ -n "$log_file" && -f "$log_file" ]]; then
    should_scan_log=true

    # A fresh heartbeat is a stronger success signal than a reused log tail.
    if [[ "$heartbeat_fresh" == true ]]; then
      should_scan_log=false
    else
      log_mtime=$(stat -c %Y "$log_file" 2>/dev/null || echo 0)
      if [[ "$log_mtime" -gt 0 ]]; then
        interval=${HEARTBEAT_INTERVALS[$name]:-$(estimate_schedule_interval "$sched")}
        max_log_age=$((interval + interval / 2))
        log_age=$((NOW - log_mtime))
        if [[ "$log_age" -gt "$max_log_age" ]]; then
          should_scan_log=false
        fi
      fi
    fi

    if [[ "$should_scan_log" == true ]]; then
      # "Last summary wins": if the most recent summary line in the log
      # reports zero failures, the job is healthy regardless of older entries.
      # This prevents stale errors from a previous run triggering warnings.
      last_summary=$(tail -20 "$log_file" 2>/dev/null \
        | tac | grep -m1 -iP '\d+\s+(passed|failed|errors)' || true)
      if [[ -n "$last_summary" ]] \
        && echo "$last_summary" | grep -qiP '0\s+failed?\b|failed?:\s*0\b|\b0\s+errors?\b'; then
        : # Most recent run passed — skip error counting
      else
        # Check last 20 lines for error/fail patterns
        recent_errors=$(tail -20 "$log_file" 2>/dev/null \
          | grep -viP 'errors?:\s*0\b|failed?:\s*0\b|\b0\s+errors?\b|\b0\s+failed\b' \
          | grep -ciP 'error|fail|fatal|panic|traceback' || true)
        if [[ "$recent_errors" -gt 0 ]]; then
          status="WARN"
          notes="$recent_errors error(s) in recent log output ($log_file)"
          WARN=$((WARN + 1))
          WARNINGS+=("$name: $notes")
          DETAILS+=("$status | $sched | $name — $notes")
          continue
        fi
      fi
    fi
  fi

  OK=$((OK + 1))
  DETAILS+=("$status   | $sched | $name")
done

# --- Output ---

if $BRIEF_MODE; then
  if [[ $FAIL -gt 0 ]]; then
    echo "CRON: ${TOTAL} jobs — ${FAIL} BROKEN, ${WARN} warnings, ${OK} ok, ${SKIP} skipped"
    exit 1
  elif [[ $WARN -gt 0 ]]; then
    echo "CRON: ${TOTAL} jobs — ${WARN} warnings, ${OK} ok, ${SKIP} skipped"
    exit 0
  else
    echo "CRON: ${TOTAL} jobs — all healthy (${OK} ok, ${SKIP} skipped)"
    exit 0
  fi
fi

if $ALERT_MODE; then
  if [[ $FAIL -gt 0 || $WARN -gt 0 ]]; then
    echo "STALE: ${TOTAL} jobs - ${FAIL} broken, ${WARN} warnings, ${OK} ok, ${SKIP} skipped"
    for p in "${PROBLEMS[@]:0:5}"; do
      echo "- BROKEN: $p"
    done
    for w in "${WARNINGS[@]:0:5}"; do
      echo "- WARN: $w"
    done
    exit 1
  fi

  echo "OK: ${TOTAL} jobs - all healthy (${OK} ok, ${SKIP} skipped)"
  exit 0
fi

if $JSON_MODE; then
  echo "{"
  echo "  \"generatedAt\": \"$GENERATED_AT\","
  echo "  \"total\": $TOTAL,"
  echo "  \"ok\": $OK,"
  echo "  \"warn\": $WARN,"
  echo "  \"fail\": $FAIL,"
  echo "  \"skip\": $SKIP,"

  echo "  \"problems\": ["
  for j in "${!PROBLEMS[@]}"; do
    comma=","; [[ $j -eq $((${#PROBLEMS[@]}-1)) ]] && comma=""
    echo "    \"${PROBLEMS[$j]}\"$comma"
  done
  echo "  ],"

  echo "  \"warnings\": ["
  for j in "${!WARNINGS[@]}"; do
    comma=","; [[ $j -eq $((${#WARNINGS[@]}-1)) ]] && comma=""
    echo "    \"${WARNINGS[$j]}\"$comma"
  done
  echo "  ]"
  echo "}"
  [[ $FAIL -gt 0 ]] && exit 1
  exit 0
fi

# Human-readable
echo "=== CRON HEALTH AUDIT ==="
echo ""
printf "%-6s| %-19s| %s\n" "STATUS" "SCHEDULE" "JOB"
printf "%s\n" "------|-------------------|------------------------------------------"
for d in "${DETAILS[@]}"; do
  echo "$d"
done

echo ""
echo "Summary: $TOTAL jobs — $OK ok, $WARN warnings, $FAIL broken, $SKIP skipped"

if [[ ${#PROBLEMS[@]} -gt 0 ]]; then
  echo ""
  echo "BROKEN:"
  for p in "${PROBLEMS[@]}"; do echo "  ✗ $p"; done
fi

if [[ ${#WARNINGS[@]} -gt 0 ]]; then
  echo ""
  echo "WARNINGS:"
  for w in "${WARNINGS[@]}"; do echo "  ⚠ $w"; done
fi

[[ $FAIL -gt 0 ]] && exit 1
exit 0
