#!/usr/bin/env bash
# Google API Health Monitor
# Runs daily, checks all API connectivity, logs results.

LOG="/var/log/google-api-monitor.log"
timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

source /root/overlord/.env 2>/dev/null || true
GKEY="${GOOGLE_API_KEY:-}"

echo "$(timestamp) === Daily API Health Check ===" >> "$LOG"

# --- API Key APIs ---
if [ -n "$GKEY" ]; then
    # Gemini
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://generativelanguage.googleapis.com/v1beta/models?key=$GKEY" 2>/dev/null)
    [ "$STATUS" = "200" ] && echo "$(timestamp) [OK] Gemini" >> "$LOG" || echo "$(timestamp) [FAIL] Gemini (HTTP $STATUS)" >> "$LOG"

    # Veo
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001?key=$GKEY" 2>/dev/null)
    [ "$STATUS" = "200" ] && echo "$(timestamp) [OK] Veo" >> "$LOG" || echo "$(timestamp) [FAIL] Veo (HTTP $STATUS)" >> "$LOG"

    # Imagen
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" "https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001?key=$GKEY" 2>/dev/null)
    [ "$STATUS" = "200" ] && echo "$(timestamp) [OK] Imagen" >> "$LOG" || echo "$(timestamp) [FAIL] Imagen (HTTP $STATUS)" >> "$LOG"
else
    echo "$(timestamp) [SKIP] No GOOGLE_API_KEY" >> "$LOG"
fi

# --- Workspace OAuth ---
if command -v gws &>/dev/null; then
    RESP=$(gws drive about get --params '{"fields": "user"}' 2>&1)
    if echo "$RESP" | grep -q '"emailAddress"'; then
        echo "$(timestamp) [OK] Workspace OAuth" >> "$LOG"
    else
        echo "$(timestamp) [FAIL] Workspace OAuth — needs: gws auth login" >> "$LOG"
    fi
fi

echo "$(timestamp) === End ===" >> "$LOG"

# Trim log
if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 1000 ]; then
    tail -500 "$LOG" > "${LOG}.tmp" && mv "${LOG}.tmp" "$LOG"
fi
