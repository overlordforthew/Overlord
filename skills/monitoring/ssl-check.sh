#!/bin/bash
# ssl-check.sh — Check SSL certificate expiry for all domains
set -euo pipefail

DOMAINS="namibarden.com lumina.namibarden.com mastercommander.namibarden.com surfababe.namibarden.com onlyhulls.com onlydrafting.com"
WARN_DAYS=14
NOW=$(date +%s)

echo "=== SSL Certificate Check ==="
for DOMAIN in $DOMAINS; do
    EXPIRY_STR=$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN":443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
    if [ -n "$EXPIRY_STR" ]; then
        EXPIRY_EPOCH=$(date -d "$EXPIRY_STR" +%s 2>/dev/null || echo "0")
        DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW) / 86400 ))
        if [ "$DAYS_LEFT" -lt "$WARN_DAYS" ]; then
            echo "  WARNING  $DOMAIN — expires in $DAYS_LEFT days ($EXPIRY_STR)"
        else
            echo "  OK       $DOMAIN — $DAYS_LEFT days left ($EXPIRY_STR)"
        fi
    else
        echo "  ERROR    $DOMAIN — could not check"
    fi
done
