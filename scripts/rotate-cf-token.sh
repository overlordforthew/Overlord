#!/bin/bash
# rotate-cf-token.sh — Verify Cloudflare API token health quarterly
#
# User API Tokens can't self-rotate via API (CF limitation).
# This script verifies the token is still active and tests key permissions.
# If anything fails, it logs a warning for manual attention.
#
# Cron: 0 4 1 1,4,7,10 * /root/overlord/scripts/rotate-cf-token.sh >> /var/log/cf-rotate.log 2>&1

set -euo pipefail

ENV_FILE="/root/overlord/.env"
ACCOUNT_ID="099cbdaaadc71eef10329f795a4e564f"
ZONE_ID="51ea8958dc949e1793c0d31435cfa699"  # namibarden.com
LOG_PREFIX="[cf-token $(date '+%Y-%m-%d %H:%M')]"
FAILURES=0

TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' "$ENV_FILE" | cut -d= -f2)
if [ -z "$TOKEN" ]; then
    echo "$LOG_PREFIX ERROR: No CLOUDFLARE_API_TOKEN in $ENV_FILE"
    exit 1
fi

check() {
    local name="$1" result="$2"
    local ok=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success', False))" 2>/dev/null || echo "False")
    if [ "$ok" = "True" ]; then
        echo "$LOG_PREFIX $name: OK"
    else
        echo "$LOG_PREFIX $name: FAILED"
        FAILURES=$((FAILURES + 1))
    fi
}

echo "$LOG_PREFIX Starting quarterly token health check..."

# Core checks
check "Token verify" "$(curl -s "https://api.cloudflare.com/client/v4/user/tokens/verify" -H "Authorization: Bearer $TOKEN")"
check "Zone list" "$(curl -s "https://api.cloudflare.com/client/v4/zones?per_page=1" -H "Authorization: Bearer $TOKEN")"
check "DNS read" "$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?per_page=1" -H "Authorization: Bearer $TOKEN")"
check "Zone settings" "$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/settings" -H "Authorization: Bearer $TOKEN")"
check "Cache purge" "$(curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data '{"files":["https://namibarden.com/health-check-purge"]}')"

if [ "$FAILURES" -gt 0 ]; then
    echo "$LOG_PREFIX WARNING: $FAILURES permission(s) failed. Token may need manual rotation."
    echo "$LOG_PREFIX Dashboard: https://dash.cloudflare.com/profile/api-tokens"
else
    echo "$LOG_PREFIX All checks passed. Token healthy."
fi
