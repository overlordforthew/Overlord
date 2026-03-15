#!/bin/bash
# smoke-tests.sh — Project-specific smoke tests after deploy
# Usage: smoke-tests.sh <project-name>
# Returns pass/fail counts on stdout, exit 0 if all pass

PROJECT="${1,,}"  # lowercase
PASS=0
FAIL=0
RESULTS=""

check_url() {
  local url="$1"
  local label="$2"
  local expected="${3:-200}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 --max-time 10 "$url" 2>/dev/null)
  if [ "$status" = "$expected" ]; then
    PASS=$((PASS + 1))
    RESULTS="${RESULTS}\n  ✅ ${label}: HTTP ${status}"
  else
    FAIL=$((FAIL + 1))
    RESULTS="${RESULTS}\n  ❌ ${label}: HTTP ${status} (expected ${expected})"
  fi
}

case "$PROJECT" in
  namibarden)
    check_url "https://namibarden.com" "Homepage"
    check_url "https://namibarden.com/admin" "Admin panel"
    check_url "https://namibarden.com/api/health" "API health" "200"
    ;;
  beastmode)
    check_url "https://beastmode.namibarden.com" "Homepage"
    ;;
  lumina)
    check_url "https://lumina.namibarden.com" "Homepage"
    check_url "https://lumina.namibarden.com/api/health" "API health"
    ;;
  mastercommander)
    check_url "https://mastercommander.namibarden.com" "Homepage"
    ;;
  surfababe)
    check_url "https://surfababe.namibarden.com" "Homepage"
    ;;
  elmo)
    check_url "https://onlydrafting.com" "Homepage"
    ;;
  onlyhulls)
    check_url "https://onlyhulls.com" "Homepage"
    ;;
  overlord)
    # Overlord is a WhatsApp bot, just check the health endpoint
    check_url "http://localhost:3002/health" "Health endpoint"
    ;;
  *)
    echo "Unknown project: $PROJECT"
    exit 0
    ;;
esac

echo -e "Smoke tests for ${PROJECT}: ${PASS} passed, ${FAIL} failed${RESULTS}"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
