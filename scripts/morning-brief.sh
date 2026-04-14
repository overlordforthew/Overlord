#!/bin/bash
# morning-brief.sh — Daily briefing generator (log file version)
# The WhatsApp briefing is sent by scheduler.js in the bot container

set -euo pipefail

# Container name mapping
declare -A NAMES=(
  [coolify-proxy]="Traefik Proxy"
  [coolify]="Coolify"
  [coolify-realtime]="Coolify Realtime"
  [coolify-db]="Coolify DB"
  [coolify-redis]="Coolify Redis"
  [coolify-sentinel]="Coolify Sentinel"
  [overlord]="Overlord (WhatsApp Bot)"
  [surfababe]="SurfaBabe (WhatsApp Bot)"
  [mastercommander]="MasterCommander"
)

friendly_name() {
  local raw="$1"
  if [[ -n "${NAMES[$raw]+x}" ]]; then
    echo "${NAMES[$raw]}"
    return
  fi
  # Try Docker labels: serviceName + projectName
  local svc proj
  svc=$(docker inspect --format '{{index .Config.Labels "coolify.serviceName"}}' "$raw" 2>/dev/null || true)
  proj=$(docker inspect --format '{{index .Config.Labels "coolify.projectName"}}' "$raw" 2>/dev/null || true)
  if [[ -n "$svc" && "$svc" != "<no value>" ]]; then
    # Clean up Coolify's verbose names
    if [[ "$svc" == bluemele-* && -n "$proj" && "$proj" != "<no value>" ]]; then
      echo "${proj^}"
    elif [[ "$svc" == "api" && -n "$proj" && "$proj" != "<no value>" ]]; then
      echo "${proj^} API"
    else
      echo "${svc^}"
    fi
    return
  fi
  echo "$raw"
}

echo "========================================="
echo "  OVERLORD Daily Brief — $(date '+%A, %B %d %Y')"
echo "========================================="
echo ""

# Server health
echo "## Server Health"
echo "- Uptime: $(uptime -p)"
echo "- Memory: $(free -h | awk '/Mem/{printf "%s/%s (%s free)", $3, $2, $4}')"
echo "- Disk: $(df -h / | tail -1 | awk '{printf "%s/%s (%s)", $3, $2, $5}')"
echo ""

# Docker status with friendly names
echo "## Containers"
RUNNING=$(docker ps --format '{{.Names}}' 2>/dev/null | wc -l)
STOPPED=$(docker ps -a --filter "status=exited" --format '{{.Names}}' 2>/dev/null | wc -l)
echo "- Running: $RUNNING"
echo "- Stopped: $STOPPED"
if [ "$STOPPED" -gt 0 ]; then
    echo "- Stopped containers:"
    docker ps -a --filter "status=exited" --format '{{.Names}}' 2>/dev/null | while read -r name; do
        echo "    - $(friendly_name "$name")"
    done
fi
echo ""

# Running containers with friendly names
echo "## Running"
docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null | while IFS=$'\t' read -r name status; do
    echo "  $(friendly_name "$name"): $status"
done
echo ""

# Fail2ban
echo "## Fail2ban"
for jail in $(fail2ban-client status 2>/dev/null | grep "Jail list" | sed 's/.*://;s/,//g'); do
    count=$(fail2ban-client status "$jail" 2>/dev/null | grep "Currently banned" | awk '{print $NF}')
    total=$(fail2ban-client status "$jail" 2>/dev/null | grep "Total banned" | awk '{print $NF}')
    echo "  $jail: $count active / $total total bans"
done
echo ""

# Inbox check
INBOX="/root/overlord/INBOX.md"
if [ -f "$INBOX" ]; then
    PENDING=$(grep -c '^\- \[ \]' "$INBOX" 2>/dev/null || true)
    PENDING=${PENDING:-0}
    echo "## Inbox"
    echo "- Pending tasks: $PENDING"
    if [ "$PENDING" -gt 0 ]; then
        grep '^\- \[ \]' "$INBOX" 2>/dev/null | head -5
    fi
    echo ""
fi

# Backup status
BACKUP_DIR="/root/backups"
if [ -d "$BACKUP_DIR" ]; then
    LATEST=$(ls -t "$BACKUP_DIR"/*.tar.gz 2>/dev/null | head -1)
    if [ -n "$LATEST" ]; then
        echo "## Backups"
        echo "- Latest: $(basename "$LATEST") ($(stat -c %y "$LATEST" | cut -d' ' -f1))"
        echo "- Count: $(ls "$BACKUP_DIR"/*.tar.gz 2>/dev/null | wc -l) backup files"
    fi
fi

echo ""
echo "========================================="
echo "  End of Brief"
echo "========================================="

# Cron heartbeat
mkdir -p /root/overlord/data/cron-heartbeats
date +%s > /root/overlord/data/cron-heartbeats/morning-brief
