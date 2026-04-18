#!/bin/bash
# update-status.sh — Refresh STATUS.md with current server state

set -euo pipefail

STATUS_FILE="/root/overlord/STATUS.md"
IGNORED_STOPPED_REGEX='^beastmode-.*(pg-test|polish-pg|final-pg).*'

list_actionable_stopped_containers() {
    local format="$1"
    docker ps -a --filter "status=exited" --format "$format" 2>/dev/null | grep -Ev "$IGNORED_STOPPED_REGEX" || true
}

{
echo "# OVERLORD — Server Status"
echo ""
echo "Last updated: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

echo "## System"
echo "- **Uptime:** $(uptime -p)"
echo "- **Load:** $(uptime | sed 's/.*load average: //')"
echo "- **Memory:** $(free -h | awk '/Mem/{printf "%s used / %s total (%s free)", $3, $2, $4}')"
echo "- **Swap:** $(free -h | awk '/Swap/{printf "%s used / %s total", $3, $2}')"
echo "- **Disk:** $(df -h / | tail -1 | awk '{printf "%s used / %s total (%s)", $3, $2, $5}')"
echo ""

echo "## Docker Containers"
echo '```'
docker ps --format 'table {{.Names}}\t{{.Status}}' 2>/dev/null || echo "Docker not accessible"
echo '```'
echo ""

STOPPED=$(list_actionable_stopped_containers '{{.Names}}: exited {{.RunningFor}} ago')
if [ -n "$STOPPED" ]; then
    echo "## Stopped Containers"
    echo "$STOPPED" | while read -r line; do echo "- $line"; done
    echo ""
fi

echo "## Services"
echo "| Service | URL | Status |"
echo "|---------|-----|--------|"

# Check each service
for PAIR in "namibarden.com:namibarden.com" "lumina.namibarden.com:Lumina"; do
    URL="${PAIR%%:*}"
    NAME="${PAIR##*:}"
    HTTP_CODE=$(curl -sL -o /dev/null -w '%{http_code}' --max-time 5 "https://$URL" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 400 ]; then
        STATUS="UP ($HTTP_CODE)"
    else
        STATUS="DOWN ($HTTP_CODE)"
    fi
    echo "| $NAME | https://$URL | $STATUS |"
done
echo ""

echo "## Tailscale"
if command -v tailscale &>/dev/null; then
    echo '```'
    tailscale status 2>/dev/null | head -5 || echo "Not running"
    echo '```'
else
    echo "Not installed"
fi

} > "$STATUS_FILE"

echo "STATUS.md updated at $(date -u '+%H:%M:%S UTC')"
