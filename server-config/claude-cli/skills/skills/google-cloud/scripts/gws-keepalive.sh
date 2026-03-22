#!/usr/bin/env bash
# GWS OAuth Token Keepalive
# Makes a lightweight API call to keep the refresh token alive.
# Should run every 4 hours via cron.

LOG="/var/log/gws-keepalive.log"

timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

# Try a lightweight Drive about call
RESP=$(gws drive about get --params '{"fields": "user"}' 2>&1)

if echo "$RESP" | grep -q '"emailAddress"'; then
    EMAIL=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('user',{}).get('emailAddress','ok'))" 2>/dev/null)
    echo "$(timestamp) [OK] Token alive — $EMAIL" >> "$LOG"
else
    echo "$(timestamp) [FAIL] Token dead — $(echo "$RESP" | head -1)" >> "$LOG"

    # Check if this is a persistent failure (3+ consecutive fails)
    FAIL_COUNT=$(tail -5 "$LOG" 2>/dev/null | grep -c "\[FAIL\]")
    if [ "$FAIL_COUNT" -ge 3 ]; then
        echo "$(timestamp) [ALERT] 3+ consecutive auth failures — needs manual re-auth: gws auth login" >> "$LOG"
    fi
fi

# Keep log from growing forever
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 500 ]; then
    tail -200 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi
