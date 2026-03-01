#!/bin/bash
# service-check.sh — Check all services and containers
set -euo pipefail

BRIEF=false
[ "${1:-}" = "--brief" ] && BRIEF=true

# Check Docker containers
RUNNING=$(docker ps --format '{{.Names}}' 2>/dev/null | wc -l)
STOPPED=$(docker ps -a --filter "status=exited" --format '{{.Names}}' 2>/dev/null | wc -l)
UNHEALTHY=$(docker ps --filter "health=unhealthy" --format '{{.Names}}' 2>/dev/null | wc -l)

if $BRIEF; then
    ISSUES=0
    [ "$STOPPED" -gt 0 ] && ISSUES=$((ISSUES + STOPPED))
    [ "$UNHEALTHY" -gt 0 ] && ISSUES=$((ISSUES + UNHEALTHY))
    if [ "$ISSUES" -eq 0 ]; then
        echo "All good: $RUNNING containers running, 0 issues"
    else
        echo "WARNING: $RUNNING running, $STOPPED stopped, $UNHEALTHY unhealthy"
    fi
    exit 0
fi

echo "=== Service Health Check ==="
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

echo "--- Containers ($RUNNING running) ---"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null
echo ""

if [ "$STOPPED" -gt 0 ]; then
    echo "--- STOPPED Containers ($STOPPED) ---"
    docker ps -a --filter "status=exited" --format '{{.Names}}: {{.Status}}' 2>/dev/null
    echo ""
fi

if [ "$UNHEALTHY" -gt 0 ]; then
    echo "--- UNHEALTHY Containers ($UNHEALTHY) ---"
    docker ps --filter "health=unhealthy" --format '{{.Names}}: {{.Status}}' 2>/dev/null
    echo ""
fi

# Check web endpoints
echo "--- Web Services ---"
for PAIR in "namibarden.com" "lumina.namibarden.com" "onlydrafting.com"; do
    CODE=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 5 "https://$PAIR" 2>/dev/null || echo "000")
    if [ "$CODE" -ge 200 ] && [ "$CODE" -lt 400 ]; then
        echo "  UP  ($CODE) https://$PAIR"
    else
        echo "  DOWN ($CODE) https://$PAIR"
    fi
done
echo ""

# System resources
echo "--- Resources ---"
echo "Memory: $(free -h | awk '/Mem/{printf "%s / %s (%s free)", $3, $2, $4}')"
echo "Disk:   $(df -h / | tail -1 | awk '{printf "%s / %s (%s)", $3, $2, $5}')"
echo "Load:   $(uptime | sed 's/.*load average: //')"
