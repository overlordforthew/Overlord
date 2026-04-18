#!/bin/bash
# health-check.sh — Server health check
# Outputs clean summary of system state

set -euo pipefail
IGNORED_STOPPED_REGEX='^beastmode-.*(test|pg|hardening-run).*'

list_actionable_stopped_containers() {
    local format="$1"
    docker ps -a --filter "status=exited" --format "$format" 2>/dev/null | grep -Ev "$IGNORED_STOPPED_REGEX" || true
}

echo "=== OVERLORD Health Check ==="
echo "Date: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

# CPU
echo "--- CPU ---"
uptime | sed 's/.*load average/Load average/'
echo ""

# Memory
echo "--- Memory ---"
free -h | grep -E 'Mem|Swap'
echo ""

# Disk
echo "--- Disk ---"
df -h / | tail -1 | awk '{printf "Root: %s used / %s total (%s)\n", $3, $2, $5}'
echo ""

# Docker containers
echo "--- Docker Containers ---"
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || echo "Docker not accessible"
echo ""

# Stopped containers
STOPPED=$(list_actionable_stopped_containers '{{.Names}}' | sed '/^$/d' | wc -l)
if [ "$STOPPED" -gt 0 ]; then
    echo "Stopped containers: $STOPPED"
    list_actionable_stopped_containers '  {{.Names}} (exited {{.Status}})'
    echo ""
fi

# Tailscale
echo "--- Tailscale ---"
if command -v tailscale &>/dev/null; then
    tailscale status 2>/dev/null | head -5 || echo "Tailscale not running"
else
    echo "Tailscale not installed"
fi
echo ""

# SSL cert check for namibarden.com
echo "--- SSL Certificate ---"
EXPIRY=$(echo | openssl s_client -servername namibarden.com -connect namibarden.com:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$EXPIRY" ]; then
    echo "namibarden.com expires: $EXPIRY"
else
    echo "Could not check SSL cert"
fi
echo ""

echo "=== Health Check Complete ==="

# Cron heartbeat
mkdir -p /root/overlord/data/cron-heartbeats
date +%s > /root/overlord/data/cron-heartbeats/health-check
