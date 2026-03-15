#!/bin/bash
# auto-journal.sh — Summarize today's bot activity into daily memory log
# Reads from logs/*.jsonl and writes to memory/YYYY-MM-DD.md

set -euo pipefail

DATE=$(date +%Y-%m-%d)
JOURNAL="/root/overlord/memory/$DATE.md"
LOG_DIR="/root/overlord/logs"

# Count today's messages across all chats
TOTAL_MESSAGES=0
TOTAL_BOT_RESPONSES=0
ACTIVE_CHATS=""

for LOG_FILE in "$LOG_DIR"/*.jsonl; do
    [ -f "$LOG_FILE" ] || continue
    CHAT_ID=$(basename "$LOG_FILE" .jsonl)

    # Count messages from today
    TODAY_MSGS=$(grep "\"t\":\"${DATE}" "$LOG_FILE" 2>/dev/null | wc -l || echo "0")
    TODAY_BOT=$(grep "\"t\":\"${DATE}" "$LOG_FILE" 2>/dev/null | grep '"role":"bot"' | wc -l || echo "0")

    if [ "$TODAY_MSGS" -gt 0 ]; then
        TOTAL_MESSAGES=$((TOTAL_MESSAGES + TODAY_MSGS))
        TOTAL_BOT_RESPONSES=$((TOTAL_BOT_RESPONSES + TODAY_BOT))
        ACTIVE_CHATS="$ACTIVE_CHATS $CHAT_ID"
    fi
done

# Only write if there was activity
if [ "$TOTAL_MESSAGES" -eq 0 ]; then
    echo "No activity today — skipping journal entry"
    exit 0
fi

CHAT_COUNT=$(echo "$ACTIVE_CHATS" | wc -w)

# Check if file already exists (don't overwrite manual entries)
if [ -f "$JOURNAL" ]; then
    # Append activity summary at the end
    cat >> "$JOURNAL" << EOF

## Auto-Journal ($(date -u '+%H:%M UTC'))
- Messages: $TOTAL_MESSAGES total, $TOTAL_BOT_RESPONSES bot responses
- Active chats: $CHAT_COUNT
EOF
else
    cat > "$JOURNAL" << EOF
# $DATE — Daily Log

## Auto-Journal ($(date -u '+%H:%M UTC'))
- Messages: $TOTAL_MESSAGES total, $TOTAL_BOT_RESPONSES bot responses
- Active chats: $CHAT_COUNT

## Notes
_Add manual notes here._
EOF
fi

echo "Journal updated: $JOURNAL ($TOTAL_MESSAGES messages, $CHAT_COUNT chats)"

# Cron heartbeat
mkdir -p /root/overlord/data/cron-heartbeats
date +%s > /root/overlord/data/cron-heartbeats/auto-journal
