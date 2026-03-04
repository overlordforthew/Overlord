#!/bin/bash
# Start DB error monitor as a persistent background process
NODE_SCRIPT="/root/overlord/scripts/db-error-monitor.js"
LOG_FILE="/root/logs/db-error-monitor.log"
PID_FILE="/root/db-error-monitor.pid"

mkdir -p /root/logs

# Check if already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "DB Error Monitor already running (PID $OLD_PID)"
        exit 0
    fi
fi

# Start in background
nohup node "$NODE_SCRIPT" > "$LOG_FILE" 2>&1 &
NEW_PID=$!
echo $NEW_PID > "$PID_FILE"

echo "✅ DB Error Monitor started (PID $NEW_PID)"
echo "📝 Logs: $LOG_FILE"
echo "   File: $NODE_SCRIPT"
