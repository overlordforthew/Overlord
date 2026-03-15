#!/bin/bash
# log-analyzer — Docker log analysis, error detection, pattern mining, LLM diagnosis
# Usage: log-analyzer.sh <command> [args...]
set -euo pipefail

# ── COLORS ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
YEL='\033[0;33m'
GRN='\033[0;32m'
CYN='\033[0;36m'
BLD='\033[1m'
RST='\033[0m'

# ── ERROR PATTERNS ────────────────────────────────────────────────────────────
# Regex for matching error/warning lines across common frameworks

ERROR_PATTERN='(ERROR|ERRO|FATAL|PANIC|panic:|CRIT|CRITICAL|Unhandled|unhandledRejection|uncaughtException|OOMKilled|code 137|SIGTERM|SIGKILL|ENOMEM|out of memory|segfault|killed|Connection refused|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up)'
WARN_PATTERN='(WARN|WARNING|deprecated|retry|reconnect|disconnect|timeout|EPERM|EACCES)'

# Specific infrastructure patterns
BAILEYS_PATTERN='(DisconnectReason|Connection Closed|QR ref|connection\.update|Boom|StatusCodeError|stream:error|unexpected server response)'
PG_PATTERN='(FATAL:|could not connect|too many connections|deadlock detected|connection reset|pg_hba\.conf|authentication failed|terminating connection|remaining connection slots are reserved)'
TRAEFIK_5XX='\" [5][0-9]{2} '
OOM_PATTERN='(OOMKill|code 137|SIGKILL|out of memory|Cannot allocate memory|ENOMEM)'
NODE_PATTERN='(ERR_UNHANDLED|UnhandledPromiseRejection|RangeError|TypeError|SyntaxError|ReferenceError|heap out of memory|FATAL ERROR: .* JavaScript)'
RESTART_PATTERN='(Restarting|restart_policy|unhealthy|starting|Started container)'

# ── HELPERS ───────────────────────────────────────────────────────────────────

get_logs() {
  local container="$1"
  local lines="${2:-500}"
  local since="${3:-}"

  local args=()
  if [ -n "$since" ]; then
    args+=(--since "$since")
  else
    args+=(--tail "$lines")
  fi

  docker logs "${args[@]}" "$container" 2>&1
}

container_exists() {
  docker inspect "$1" &>/dev/null
}

require_container() {
  local container="${1:-}"
  if [ -z "$container" ]; then
    echo "Error: container name required"
    exit 1
  fi
  if ! container_exists "$container"; then
    echo "Error: container '$container' not found"
    echo "Running containers:"
    docker ps --format '  {{.Names}}' | sort
    exit 1
  fi
}

parse_since() {
  # Parse --since from remaining args, default to provided value
  local default="$1"
  shift
  local since="$default"
  while [ $# -gt 0 ]; do
    case "$1" in
      --since) since="${2:-$default}"; shift 2 ;;
      *) shift ;;
    esac
  done
  echo "$since"
}

parse_lines() {
  # Parse --lines from remaining args, default to provided value
  local default="$1"
  shift
  local lines="$default"
  while [ $# -gt 0 ]; do
    case "$1" in
      --lines) lines="${2:-$default}"; shift 2 ;;
      *) shift ;;
    esac
  done
  echo "$lines"
}

parse_interval() {
  local default="$1"
  shift
  local interval="$default"
  while [ $# -gt 0 ]; do
    case "$1" in
      --interval) interval="${2:-$default}"; shift 2 ;;
      *) shift ;;
    esac
  done
  echo "$interval"
}

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

# ── COMMANDS ──────────────────────────────────────────────────────────────────

cmd_scan() {
  local container="${1:-}"
  require_container "$container"
  shift
  local lines
  lines=$(parse_lines 500 "$@")

  echo -e "${BLD}=== Log Scan: $container (last $lines lines) ===${RST}"
  echo ""

  local logs
  logs=$(get_logs "$container" "$lines")
  local total
  total=$(echo "$logs" | wc -l)

  # Count by severity
  local errors warns
  errors=$(echo "$logs" | grep -cEi "$ERROR_PATTERN" || true)
  warns=$(echo "$logs" | grep -cEi "$WARN_PATTERN" || true)

  # Infrastructure-specific detections
  local oom_count baileys_count pg_count node_count
  oom_count=$(echo "$logs" | grep -cEi "$OOM_PATTERN" || true)
  baileys_count=$(echo "$logs" | grep -cEi "$BAILEYS_PATTERN" || true)
  pg_count=$(echo "$logs" | grep -cEi "$PG_PATTERN" || true)
  node_count=$(echo "$logs" | grep -cEi "$NODE_PATTERN" || true)

  # Summary
  echo -e "  Total lines:  $total"
  if [ "$errors" -gt 0 ]; then
    echo -e "  ${RED}Errors:       $errors${RST}"
  else
    echo -e "  ${GRN}Errors:       $errors${RST}"
  fi
  if [ "$warns" -gt 0 ]; then
    echo -e "  ${YEL}Warnings:     $warns${RST}"
  else
    echo -e "  Warnings:     $warns"
  fi

  # Show specific detections only if found
  [ "$oom_count" -gt 0 ] && echo -e "  ${RED}OOM signals:  $oom_count${RST}"
  [ "$baileys_count" -gt 0 ] && echo -e "  ${YEL}Baileys:      $baileys_count${RST}"
  [ "$pg_count" -gt 0 ] && echo -e "  ${YEL}PostgreSQL:   $pg_count${RST}"
  [ "$node_count" -gt 0 ] && echo -e "  ${RED}Node.js:      $node_count${RST}"

  echo ""

  # Show last few errors
  if [ "$errors" -gt 0 ]; then
    echo -e "${BLD}Recent errors (last 15):${RST}"
    echo "$logs" | grep -Ei "$ERROR_PATTERN" | tail -15
    echo ""
  fi

  # Show last few warnings
  if [ "$warns" -gt 0 ]; then
    echo -e "${BLD}Recent warnings (last 10):${RST}"
    echo "$logs" | grep -Ei "$WARN_PATTERN" | tail -10
  fi
}

cmd_errors() {
  local container="${1:-}"
  require_container "$container"
  shift
  local since
  since=$(parse_since "1h" "$@")

  echo -e "${BLD}=== Errors: $container (since $since) ===${RST}"
  echo ""

  local logs
  logs=$(get_logs "$container" "" "$since")

  # Extract error lines
  local error_lines
  error_lines=$(echo "$logs" | grep -Ei "$ERROR_PATTERN|$WARN_PATTERN" || true)

  if [ -z "$error_lines" ]; then
    echo -e "${GRN}No errors or warnings found.${RST}"
    return 0
  fi

  # Deduplicate and count
  echo -e "${BLD}Unique error/warning patterns (by count):${RST}"
  echo ""
  # Strip timestamps and variable data for grouping, then count
  echo "$error_lines" \
    | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}[^ ]* //' \
    | sed -E 's/\b[0-9a-f]{8,}\b/ID/g' \
    | sed -E 's/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/IP/g' \
    | sed -E 's/:[0-9]{4,5}/PORT/g' \
    | sed -E 's/pid=[0-9]+/pid=N/g' \
    | sort | uniq -c | sort -rn | head -30

  echo ""
  echo -e "${BLD}Total unique patterns:${RST} $(echo "$error_lines" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}[^ ]* //' | sort -u | wc -l)"
  echo -e "${BLD}Total error lines:${RST}    $(echo "$error_lines" | wc -l)"
}

cmd_traefik() {
  local since
  since=$(parse_since "1h" "$@")

  # Find the Traefik container
  local traefik_container
  traefik_container=$(docker ps --format '{{.Names}}' | grep -i 'traefik\|coolify-proxy' | head -1 || true)

  if [ -z "$traefik_container" ]; then
    echo "Error: No Traefik container found"
    docker ps --format '{{.Names}}' | sort
    exit 1
  fi

  echo -e "${BLD}=== Traefik Analysis: $traefik_container (since $since) ===${RST}"
  echo ""

  local logs
  logs=$(get_logs "$traefik_container" "" "$since")
  local total
  total=$(echo "$logs" | wc -l)

  # Count 5xx responses
  local count_500 count_502 count_503 count_504 count_5xx
  count_500=$(echo "$logs" | grep -cE '" 500 ' || true)
  count_502=$(echo "$logs" | grep -cE '" 502 ' || true)
  count_503=$(echo "$logs" | grep -cE '" 503 ' || true)
  count_504=$(echo "$logs" | grep -cE '" 504 ' || true)
  count_5xx=$(echo "$logs" | grep -cE "$TRAEFIK_5XX" || true)

  # Count 4xx
  local count_401 count_403 count_404 count_429
  count_401=$(echo "$logs" | grep -cE '" 401 ' || true)
  count_403=$(echo "$logs" | grep -cE '" 403 ' || true)
  count_404=$(echo "$logs" | grep -cE '" 404 ' || true)
  count_429=$(echo "$logs" | grep -cE '" 429 ' || true)

  echo "  Total log lines: $total"
  echo ""
  echo -e "${BLD}HTTP Status Codes:${RST}"
  if [ "$count_5xx" -gt 0 ]; then
    echo -e "  ${RED}5xx total:  $count_5xx${RST}"
    [ "$count_500" -gt 0 ] && echo -e "    ${RED}500: $count_500${RST}"
    [ "$count_502" -gt 0 ] && echo -e "    ${RED}502: $count_502${RST}"
    [ "$count_503" -gt 0 ] && echo -e "    ${RED}503: $count_503${RST}"
    [ "$count_504" -gt 0 ] && echo -e "    ${RED}504: $count_504${RST}"
  else
    echo -e "  ${GRN}5xx total:  0${RST}"
  fi
  echo "  401: $count_401  403: $count_403  404: $count_404  429: $count_429"

  echo ""

  # Top error URLs (5xx)
  if [ "$count_5xx" -gt 0 ]; then
    echo -e "${BLD}Top 5xx URLs:${RST}"
    echo "$logs" | grep -E "$TRAEFIK_5XX" \
      | sed -E 's/.*"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) ([^ ]+) .*/\1 \2/' \
      | sort | uniq -c | sort -rn | head -15
    echo ""
  fi

  # Top 404 URLs
  if [ "$count_404" -gt 5 ]; then
    echo -e "${BLD}Top 404 URLs (possible scanners):${RST}"
    echo "$logs" | grep -E '" 404 ' \
      | sed -E 's/.*"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) ([^ ]+) .*/\1 \2/' \
      | sort | uniq -c | sort -rn | head -10
    echo ""
  fi

  # Rate limit hits (429)
  if [ "$count_429" -gt 0 ]; then
    echo -e "${YEL}Rate limited requests (429):${RST}"
    echo "$logs" | grep -E '" 429 ' \
      | sed -E 's/.*"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) ([^ ]+) .*/\1 \2/' \
      | sort | uniq -c | sort -rn | head -10
    echo ""
  fi

  # Source IPs with most errors
  if [ "$count_5xx" -gt 0 ]; then
    echo -e "${BLD}Top source IPs (5xx):${RST}"
    echo "$logs" | grep -E "$TRAEFIK_5XX" \
      | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' \
      | sort | uniq -c | sort -rn | head -10
    echo ""
  fi

  # Auth failures
  if [ "$count_401" -gt 5 ]; then
    echo -e "${YEL}Top source IPs (401 — brute force?):${RST}"
    echo "$logs" | grep -E '" 401 ' \
      | grep -oE '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' \
      | sort | uniq -c | sort -rn | head -10
    echo ""
  fi

  # Traefik internal errors
  local internal_errors
  internal_errors=$(echo "$logs" | grep -ciE 'level=error|level=fatal|entrypoint.*error' || true)
  if [ "$internal_errors" -gt 0 ]; then
    echo -e "${RED}Traefik internal errors: $internal_errors${RST}"
    echo "$logs" | grep -iE 'level=error|level=fatal' | tail -10
  fi
}

cmd_health() {
  echo -e "${BLD}=== Health Scan: All Containers (last 100 lines each) ===${RST}"
  echo ""

  local containers
  containers=$(docker ps --format '{{.Names}}' | sort)
  local problem_count=0

  printf "%-30s %-8s %-8s %-8s %-6s %s\n" "CONTAINER" "ERRORS" "WARNS" "OOM" "UPTIME" "STATUS"
  printf "%-30s %-8s %-8s %-8s %-6s %s\n" "---------" "------" "-----" "---" "------" "------"

  while read -r name; do
    [ -z "$name" ] && continue

    local logs errors warns oom_count status uptime_str restarts

    # Get uptime
    local started_at
    started_at=$(docker inspect --format '{{.State.StartedAt}}' "$name" 2>/dev/null || echo "")
    if [ -n "$started_at" ] && [ "$started_at" != "0001-01-01T00:00:00Z" ]; then
      local now_epoch start_epoch diff_h
      now_epoch=$(date +%s)
      start_epoch=$(date -d "$started_at" +%s 2>/dev/null || echo "$now_epoch")
      diff_h=$(( (now_epoch - start_epoch) / 3600 ))
      if [ "$diff_h" -lt 1 ]; then
        uptime_str="<1h"
      elif [ "$diff_h" -lt 24 ]; then
        uptime_str="${diff_h}h"
      else
        uptime_str="$((diff_h / 24))d"
      fi
    else
      uptime_str="?"
    fi

    # Check restart count
    restarts=$(docker inspect --format '{{.RestartCount}}' "$name" 2>/dev/null || echo "0")

    logs=$(docker logs --tail 100 "$name" 2>&1 || true)
    errors=$(echo "$logs" | grep -cEi "$ERROR_PATTERN" || true)
    warns=$(echo "$logs" | grep -cEi "$WARN_PATTERN" || true)
    oom_count=$(echo "$logs" | grep -cEi "$OOM_PATTERN" || true)

    # Determine status
    status="${GRN}OK${RST}"
    if [ "$oom_count" -gt 0 ]; then
      status="${RED}OOM${RST}"
      problem_count=$((problem_count + 1))
    elif [ "$errors" -gt 5 ]; then
      status="${RED}ERRORS${RST}"
      problem_count=$((problem_count + 1))
    elif [ "$errors" -gt 0 ]; then
      status="${YEL}WARN${RST}"
      problem_count=$((problem_count + 1))
    elif [ "$restarts" -gt 3 ]; then
      status="${RED}RESTART${RST}"
      problem_count=$((problem_count + 1))
    fi

    printf "%-30s %-8s %-8s %-8s %-6s " "$name" "$errors" "$warns" "$oom_count" "$uptime_str"
    echo -e "$status"

  done <<< "$containers"

  echo ""
  if [ "$problem_count" -eq 0 ]; then
    echo -e "${GRN}All containers healthy.${RST}"
  else
    echo -e "${YEL}$problem_count container(s) with issues. Run 'log-analyzer.sh scan <container>' for details.${RST}"
  fi

  # Check for restart loops
  echo ""
  echo -e "${BLD}Restart counts:${RST}"
  docker ps --format '{{.Names}}' | while read -r name; do
    local rc
    rc=$(docker inspect --format '{{.RestartCount}}' "$name" 2>/dev/null || echo "0")
    if [ "$rc" -gt 0 ]; then
      if [ "$rc" -gt 5 ]; then
        echo -e "  ${RED}$name: $rc restarts${RST}"
      else
        echo -e "  ${YEL}$name: $rc restarts${RST}"
      fi
    fi
  done
  echo "  (only containers with restarts shown)"
}

cmd_diagnose() {
  local container="${1:-}"
  require_container "$container"

  if ! command -v llm &>/dev/null; then
    echo "Error: 'llm' CLI not found. Install with: pip install llm llm-openrouter"
    exit 1
  fi

  echo -e "${BLD}=== Diagnosing: $container ===${RST}"
  echo "Collecting recent error logs..."
  echo ""

  local logs error_lines
  logs=$(get_logs "$container" 1000)
  error_lines=$(echo "$logs" | grep -Ei "$ERROR_PATTERN|$WARN_PATTERN" | tail -200 || true)

  if [ -z "$error_lines" ]; then
    echo -e "${GRN}No errors found in last 1000 lines. Nothing to diagnose.${RST}"
    return 0
  fi

  local error_count
  error_count=$(echo "$error_lines" | wc -l)
  echo "Found $error_count error/warning lines. Sending to LLM for analysis..."
  echo ""

  # Get container info for context
  local image
  image=$(docker inspect --format '{{.Config.Image}}' "$container" 2>/dev/null || echo "unknown")
  local restarts
  restarts=$(docker inspect --format '{{.RestartCount}}' "$container" 2>/dev/null || echo "0")

  # Build prompt
  local prompt
  prompt="You are a senior DevOps engineer analyzing Docker container logs.

Container: $container
Image: $image
Restart count: $restarts
Server: Hetzner CX33 (4-core AMD EPYC, 8GB RAM, Ubuntu 24.04)
Stack: Docker, Traefik v3, PostgreSQL 17, Node.js apps

Here are the most recent error/warning lines from this container:

---
$error_lines
---

Analyze these logs and provide:
1. ROOT CAUSE: What is the most likely root cause of these errors?
2. SEVERITY: Critical / High / Medium / Low
3. PATTERN: Are these errors recurring, transient, or cascading from another issue?
4. FIX: Specific steps to resolve this (be actionable, not generic)
5. PREVENTION: How to prevent recurrence

Be concise and technical. This is for an experienced developer."

  echo -e "${CYN}--- LLM Analysis ---${RST}"
  echo ""
  echo "$prompt" | llm -m openrouter/openrouter/free 2>&1
  echo ""
  echo -e "${CYN}--- End Analysis ---${RST}"
}

cmd_watch() {
  local container="${1:-}"
  require_container "$container"
  shift
  local interval
  interval=$(parse_interval 60 "$@")

  echo -e "${BLD}=== Watching: $container (interval: ${interval}s) ===${RST}"
  echo "Press Ctrl+C to stop"
  echo ""

  local last_check
  last_check=$(date +%s)

  # Initial scan
  docker logs --since "${interval}s" "$container" 2>&1 | grep -Ei "$ERROR_PATTERN" | while read -r line; do
    echo -e "${RED}[$(timestamp)] $line${RST}"
  done

  # Continuous monitoring
  while true; do
    sleep "$interval"

    local new_errors
    new_errors=$(docker logs --since "${interval}s" "$container" 2>&1 | grep -Ei "$ERROR_PATTERN" || true)

    if [ -n "$new_errors" ]; then
      local count
      count=$(echo "$new_errors" | wc -l)
      echo -e "${RED}[$(timestamp)] === $count new error(s) ===${RST}"
      echo "$new_errors" | while read -r line; do
        echo -e "  ${RED}$line${RST}"
      done

      # Special alerts
      if echo "$new_errors" | grep -qEi "$OOM_PATTERN"; then
        echo -e "${RED}[$(timestamp)] !!! OOM DETECTED !!! Container may have been killed${RST}"
      fi
      if echo "$new_errors" | grep -qEi "$BAILEYS_PATTERN"; then
        echo -e "${YEL}[$(timestamp)] Baileys disconnect/reconnect detected${RST}"
      fi
      if echo "$new_errors" | grep -qEi "$PG_PATTERN"; then
        echo -e "${YEL}[$(timestamp)] PostgreSQL connection issue detected${RST}"
      fi
    else
      echo -e "${GRN}[$(timestamp)] No errors in last ${interval}s${RST}"
    fi

    last_check=$(date +%s)
  done
}

cmd_patterns() {
  local container="${1:-}"
  require_container "$container"
  shift
  local lines
  lines=$(parse_lines 1000 "$@")

  echo -e "${BLD}=== Log Patterns: $container (last $lines lines) ===${RST}"
  echo ""

  local logs
  logs=$(get_logs "$container" "$lines")

  # Normalize log lines: strip timestamps, IDs, IPs, ports, numbers
  echo -e "${BLD}Top 30 log patterns (normalized):${RST}"
  echo ""
  echo "$logs" \
    | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}[^ ]* //' \
    | sed -E 's/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/UUID/g' \
    | sed -E 's/\b[0-9a-f]{24,}\b/ID/g' \
    | sed -E 's/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/IP/g' \
    | sed -E 's/:[0-9]{4,5}\b/PORT/g' \
    | sed -E 's/pid=[0-9]+/pid=N/g' \
    | sed -E 's/\b[0-9]{10,13}\b/TIMESTAMP/g' \
    | sed -E 's/\b[0-9]+ms\b/Nms/g' \
    | sed -E 's/\b[0-9]+\.[0-9]+s\b/N.Ns/g' \
    | sed -E 's/took [0-9]+/took N/g' \
    | sort | uniq -c | sort -rn | head -30

  echo ""

  # Show error-only patterns
  local error_lines
  error_lines=$(echo "$logs" | grep -Ei "$ERROR_PATTERN" || true)
  if [ -n "$error_lines" ]; then
    echo -e "${BLD}Error patterns:${RST}"
    echo ""
    echo "$error_lines" \
      | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}[^ ]* //' \
      | sed -E 's/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/UUID/g' \
      | sed -E 's/\b[0-9a-f]{24,}\b/ID/g' \
      | sed -E 's/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/IP/g' \
      | sort | uniq -c | sort -rn | head -15
  fi

  echo ""

  # Time distribution: errors per "bucket" (approximate by log line position)
  echo -e "${BLD}Log level distribution:${RST}"
  local total errors warns info debug
  total=$(echo "$logs" | wc -l)
  errors=$(echo "$logs" | grep -cEi "$ERROR_PATTERN" || true)
  warns=$(echo "$logs" | grep -cEi "$WARN_PATTERN" || true)
  info=$(echo "$logs" | grep -cEi '\b(INFO|info)\b' || true)
  debug=$(echo "$logs" | grep -cEi '\b(DEBUG|debug|TRACE|trace)\b' || true)
  local other=$((total - errors - warns - info - debug))
  [ "$other" -lt 0 ] && other=0

  printf "  %-10s %6d  %s\n" "ERROR" "$errors" "$(printf '%*s' $((errors * 40 / (total + 1))) '' | tr ' ' '#')"
  printf "  %-10s %6d  %s\n" "WARN" "$warns" "$(printf '%*s' $((warns * 40 / (total + 1))) '' | tr ' ' '=')"
  printf "  %-10s %6d  %s\n" "INFO" "$info" "$(printf '%*s' $((info * 40 / (total + 1))) '' | tr ' ' '.')"
  printf "  %-10s %6d  %s\n" "DEBUG" "$debug" "$(printf '%*s' $((debug * 40 / (total + 1))) '' | tr ' ' ',')"
  printf "  %-10s %6d\n" "OTHER" "$other"
  printf "  %-10s %6d\n" "TOTAL" "$total"
}

# ── USAGE ─────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
log-analyzer — Docker log analysis, error detection, pattern mining, LLM diagnosis

SCANNING:
  log-analyzer.sh scan <container> [--lines N]       Scan recent logs for errors/warnings (default 500)
  log-analyzer.sh errors <container> [--since 1h]    Extract ERROR/WARN/FATAL lines with dedup + counts
  log-analyzer.sh health                             Quick scan ALL containers (last 100 lines each)

ANALYSIS:
  log-analyzer.sh traefik [--since 1h]               Traefik access log analysis: 5xx, top URLs, rate limits
  log-analyzer.sh patterns <container> [--lines N]   Most common log patterns grouped + counted
  log-analyzer.sh diagnose <container>               Feed errors to free LLM for root cause analysis

MONITORING:
  log-analyzer.sh watch <container> [--interval 60]  Tail logs and alert on error patterns (Ctrl+C to stop)

DETECTS:
  - OOM kills (code 137, SIGTERM, SIGKILL)
  - Baileys disconnects/reconnects (WhatsApp)
  - PostgreSQL connection errors
  - Traefik 5xx responses
  - Node.js unhandled rejections
  - Docker restart loops

EXAMPLES:
  log-analyzer.sh health
  log-analyzer.sh scan overlord --lines 1000
  log-analyzer.sh errors overlord --since 6h
  log-analyzer.sh traefik --since 24h
  log-analyzer.sh diagnose overlord
  log-analyzer.sh patterns coolify-proxy --lines 2000
  log-analyzer.sh watch overlord --interval 30
USAGE
}

# ── MAIN ──────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  scan)               cmd_scan "$@" ;;
  errors|errs)        cmd_errors "$@" ;;
  traefik|proxy)      cmd_traefik "$@" ;;
  health)             cmd_health "$@" ;;
  diagnose|diag)      cmd_diagnose "$@" ;;
  watch)              cmd_watch "$@" ;;
  patterns|patt)      cmd_patterns "$@" ;;
  help|--help|-h)     usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: log-analyzer.sh help"
    exit 1
    ;;
esac
