#!/bin/bash
# morning-brief.sh — Daily briefing generator

set -euo pipefail

echo "========================================="
echo "  OVERLORD Daily Brief — $(date '+%A, %B %d %Y')"
echo "========================================="
echo ""

# Server health summary
echo "## Server Health"
echo "- Uptime: $(uptime -p)"
echo "- Memory: $(free -h | awk '/Mem/{printf "%s/%s (%s free)", $3, $2, $4}')"
echo "- Disk: $(df -h / | tail -1 | awk '{printf "%s/%s (%s)", $3, $2, $5}')"
echo ""

# Docker status
echo "## Containers"
RUNNING=$(docker ps --format '{{.Names}}' 2>/dev/null | wc -l)
STOPPED=$(docker ps -a --filter "status=exited" --format '{{.Names}}' 2>/dev/null | wc -l)
echo "- Running: $RUNNING"
echo "- Stopped: $STOPPED"
if [ "$STOPPED" -gt 0 ]; then
    echo "- Stopped containers:"
    docker ps -a --filter "status=exited" --format '    - {{.Names}}' 2>/dev/null
fi
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

# Recent changelog
CHANGELOG="/root/overlord/CHANGELOG.md"
if [ -f "$CHANGELOG" ]; then
    echo "## Recent Changes"
    head -20 "$CHANGELOG" | tail -15
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
