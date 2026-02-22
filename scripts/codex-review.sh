#!/bin/bash
# codex-review.sh — Run Codex code review on recent changes
# Usage: codex-review.sh [--commit SHA] [--base BRANCH] [--uncommitted]
# Default: reviews the latest commit

set -euo pipefail

LOG="/root/overlord/logs/codex-review.log"
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M UTC')

# Default to reviewing last commit
MODE="--commit HEAD"
TITLE=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --commit) MODE="--commit $2"; TITLE="$2"; shift 2 ;;
        --base) MODE="--base $2"; TITLE="vs $2"; shift 2 ;;
        --uncommitted) MODE="--uncommitted"; TITLE="uncommitted"; shift ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

echo "[$TIMESTAMP] Running Codex review ($MODE)..." | tee -a "$LOG"

# Run review, capture output
REVIEW=$(codex review $MODE 2>&1) || true

echo "$REVIEW" | tee -a "$LOG"

# Extract just the review comments (after the last "codex" speaker line)
COMMENTS=$(echo "$REVIEW" | sed -n '/^codex$/,$ p' | tail -n +2)

if [ -z "$COMMENTS" ] || echo "$COMMENTS" | grep -q "No issues found"; then
    echo "[$TIMESTAMP] Codex review: CLEAN" | tee -a "$LOG"
    echo "CLEAN"
else
    echo "[$TIMESTAMP] Codex review: ISSUES FOUND" | tee -a "$LOG"
    echo "$COMMENTS"
fi
