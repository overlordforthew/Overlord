#!/bin/bash
set -euo pipefail

SNAPSHOT_DIR="/root/overlord/data"
SNAPSHOT_FILE="$SNAPSHOT_DIR/cron-health.json"
TMP_FILE="$SNAPSHOT_FILE.tmp"

mkdir -p "$SNAPSHOT_DIR"
bash /root/overlord-slim-context/scripts/cron-monitor.sh --json > "$TMP_FILE"
mv "$TMP_FILE" "$SNAPSHOT_FILE"

