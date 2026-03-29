#!/bin/bash
# test-aichan.sh — Self-healing health check for Ai Chan (Nami's AI agent)
# Checks + auto-fixes: container, WhatsApp, Claude CLI, managed services
# Mode: --heal (default) auto-fixes silently | --report just shows status
# Exit codes: 0 = all pass, 1 = failures remain after auto-fix attempts

MODE="${1:---heal}"
PASS=0
FAIL=0
FIXED=0
RESULTS=""
LOG="/tmp/aichan-health.log"

check() {
  local name="$1" status="$2" detail="$3"
  if [ "$status" = "OK" ]; then
    RESULTS+="  OK $name: $detail"$'\n'
    ((PASS++))
  elif [ "$status" = "FIXED" ]; then
    RESULTS+="  FIXED $name: $detail"$'\n'
    ((FIXED++))
    ((PASS++))
  else
    RESULTS+="  FAIL $name: $detail"$'\n'
    ((FAIL++))
  fi
}

heal() {
  [ "$MODE" = "--heal" ] && return 0
  return 1
}

echo "[$(date -u '+%Y-%m-%d %H:%M UTC')] Ai Chan Health Check (mode: $MODE)" | tee -a "$LOG"

# 1. Overlord container running?
OVERLORD_STATUS=$(docker inspect --format '{{.State.Running}}' overlord 2>/dev/null)
if [ "$OVERLORD_STATUS" = "true" ]; then
  check "Overlord container" "OK" "running"
else
  if heal; then
    echo "  -> Auto-healing: restarting overlord container" >> "$LOG"
    docker restart overlord >/dev/null 2>&1
    sleep 10
    NEW_STATUS=$(docker inspect --format '{{.State.Running}}' overlord 2>/dev/null)
    if [ "$NEW_STATUS" = "true" ]; then
      check "Overlord container" "FIXED" "restarted successfully"
    else
      check "Overlord container" "FAIL" "restart failed"
    fi
  else
    check "Overlord container" "FAIL" "not running"
  fi
fi

# 2. WhatsApp connected?
WA_CONNECTED=$(docker logs --tail 50 overlord 2>&1 | grep -c "Connected to WhatsApp")
if [ "$WA_CONNECTED" -gt 0 ]; then
  check "WhatsApp" "OK" "connected"
else
  if heal; then
    echo "  -> Auto-healing: restarting overlord for WhatsApp reconnect" >> "$LOG"
    docker restart overlord >/dev/null 2>&1
    sleep 15
    WA_RETRY=$(docker logs --tail 20 overlord 2>&1 | grep -c "Connected to WhatsApp")
    if [ "$WA_RETRY" -gt 0 ]; then
      check "WhatsApp" "FIXED" "reconnected after restart"
    else
      check "WhatsApp" "FAIL" "still disconnected after restart"
    fi
  else
    check "WhatsApp" "FAIL" "no recent connection"
  fi
fi

# 3. Claude CLI responds?
CLI_OUTPUT=$(docker exec overlord timeout 60 claude --model claude-haiku-4-5-20251001 -p "Reply with exactly: HEALTH_OK" --max-turns 1 2>&1)
if echo "$CLI_OUTPUT" | grep -q "HEALTH_OK"; then
  check "Claude CLI" "OK" "responding"
else
  if heal; then
    # Try auth refresh
    echo "  -> Auto-healing: refreshing Claude auth" >> "$LOG"
    docker exec overlord claude auth login --api-key 2>/dev/null
    sleep 3
    CLI_RETRY=$(docker exec overlord timeout 60 claude --model claude-haiku-4-5-20251001 -p "Reply with exactly: HEALTH_OK" --max-turns 1 2>&1)
    if echo "$CLI_RETRY" | grep -q "HEALTH_OK"; then
      check "Claude CLI" "FIXED" "auth refreshed"
    else
      check "Claude CLI" "FAIL" "still broken after auth refresh"
    fi
  else
    SNIPPET=$(echo "$CLI_OUTPUT" | tail -2 | tr '\n' ' ' | cut -c1-100)
    check "Claude CLI" "FAIL" "$SNIPPET"
  fi
fi

# 4. NamiBarden site
NB_STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://namibarden.com 2>/dev/null)
if [ "$NB_STATUS" = "200" ]; then
  check "namibarden.com" "OK" "HTTP $NB_STATUS"
else
  if heal; then
    echo "  -> Auto-healing: restarting namibarden container" >> "$LOG"
    docker restart namibarden >/dev/null 2>&1
    sleep 5
    NB_RETRY=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 https://namibarden.com 2>/dev/null)
    if [ "$NB_RETRY" = "200" ]; then
      check "namibarden.com" "FIXED" "restarted, now HTTP $NB_RETRY"
    else
      check "namibarden.com" "FAIL" "still HTTP $NB_RETRY after restart"
    fi
  else
    check "namibarden.com" "FAIL" "HTTP $NB_STATUS"
  fi
fi

# 5. Lumina
LUMINA_STATUS=$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 10 https://lumina.namibarden.com 2>/dev/null)
if [ "$LUMINA_STATUS" = "200" ] || [ "$LUMINA_STATUS" = "302" ]; then
  check "lumina" "OK" "HTTP $LUMINA_STATUS"
else
  if heal; then
    echo "  -> Auto-healing: restarting lumina containers" >> "$LOG"
    cd /projects/Lumina && docker compose restart >/dev/null 2>&1
    sleep 5
    LUMINA_RETRY=$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 10 https://lumina.namibarden.com 2>/dev/null)
    if [ "$LUMINA_RETRY" = "200" ] || [ "$LUMINA_RETRY" = "302" ]; then
      check "lumina" "FIXED" "restarted, now HTTP $LUMINA_RETRY"
    else
      check "lumina" "FAIL" "still HTTP $LUMINA_RETRY after restart"
    fi
  else
    check "lumina" "FAIL" "HTTP $LUMINA_STATUS"
  fi
fi

# 6. Memory headroom
MEM_AVAIL=$(free -m | awk '/^Mem:/{print $7}')
if [ "$MEM_AVAIL" -gt 512 ]; then
  check "Memory" "OK" "${MEM_AVAIL}MB available"
else
  if heal; then
    echo "  -> Auto-healing: clearing caches for memory" >> "$LOG"
    sync && echo 3 > /proc/sys/vm/drop_caches 2>/dev/null
    # Kill any stale claude processes inside the container
    docker exec overlord pkill -f "claude.*--model" 2>/dev/null || true
    sleep 2
    MEM_RETRY=$(free -m | awk '/^Mem:/{print $7}')
    if [ "$MEM_RETRY" -gt 512 ]; then
      check "Memory" "FIXED" "freed to ${MEM_RETRY}MB"
    else
      check "Memory" "FAIL" "only ${MEM_RETRY}MB after cleanup"
    fi
  else
    check "Memory" "FAIL" "only ${MEM_AVAIL}MB available"
  fi
fi

# 7. No zombie Claude processes
ZOMBIES=$(docker exec overlord ps -eo pid,comm 2>/dev/null | awk '$2 == "claude"' | wc -l || true)
if [ "$ZOMBIES" -le 2 ]; then
  check "Claude procs" "OK" "$ZOMBIES active"
else
  if heal; then
    echo "  -> Auto-healing: killing $ZOMBIES stale claude processes" >> "$LOG"
    docker exec overlord pkill -9 -f "claude" 2>/dev/null || true
    sleep 2
    ZOMBIES_RETRY=$(docker exec overlord ps -eo pid,comm 2>/dev/null | awk '$2 == "claude"' | wc -l || true)
    check "Claude procs" "FIXED" "killed stale procs, now $ZOMBIES_RETRY"
  else
    check "Claude procs" "FAIL" "$ZOMBIES running (leak)"
  fi
fi

# Summary
echo "$RESULTS" | tee -a "$LOG"
if [ "$FAIL" -eq 0 ]; then
  TOTAL=$((PASS))
  MSG="ALL PASS ($TOTAL checks"
  [ "$FIXED" -gt 0 ] && MSG+=", $FIXED auto-fixed"
  MSG+=")"
  echo "$MSG" | tee -a "$LOG"
  exit 0
else
  echo "FAILURES: $FAIL remain after auto-heal" | tee -a "$LOG"
  exit 1
fi
