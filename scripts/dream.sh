#!/usr/bin/env bash
# ── Overlord Nightly Dream ──────────────────────────────────────────────────
# Two-phase memory consolidation:
#   Phase 1: Mechanical — mem v2 decay/boost/prune/dedup (memory-consolidator.js)
#   Phase 2: AI review  — Claude reviews memory state and consolidates auto-memory
#
# Cron: 47 3 * * *  (3:47am daily, after mechanical consolidation at 3:30)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

LOG_DIR="/root/overlord/logs"
LOG_FILE="$LOG_DIR/dream.log"
MEMORY_DIR="/root/.claude/projects/-root/memory"
LOCK_FILE="/tmp/overlord-dream.lock"

mkdir -p "$LOG_DIR"

# Prevent concurrent runs
if [ -f "$LOCK_FILE" ]; then
  pid=$(cat "$LOCK_FILE" 2>/dev/null)
  if kill -0 "$pid" 2>/dev/null; then
    echo "$(date -Is) [SKIP] Dream already running (pid $pid)" >> "$LOG_FILE"
    exit 0
  fi
  rm -f "$LOCK_FILE"
fi
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log() { echo "$(date -Is) $1" >> "$LOG_FILE"; }

log "[START] Nightly dream cycle"

# ── Phase 1: Mechanical consolidation (mem v2 DB) ───────────────────────────
log "[PHASE1] Running memory-consolidator.js..."
PHASE1_OUT=$(docker exec overlord node /app/memory-consolidator.js 2>&1) || true
echo "$PHASE1_OUT" >> "$LOG_FILE"
log "[PHASE1] Done"

# ── Phase 2: AI memory review ───────────────────────────────────────────────
# Gather current state for the prompt
MEM_STATS=$(docker exec overlord node /app/scripts/mem.mjs stats 2>&1) || MEM_STATS="(unavailable)"
MEMORY_MD=$(cat "$MEMORY_DIR/MEMORY.md" 2>/dev/null) || MEMORY_MD="(empty)"

# Count auto-memory files (excluding MEMORY.md)
AUTO_FILES=$(find "$MEMORY_DIR" -name '*.md' ! -name 'MEMORY.md' -type f 2>/dev/null | wc -l)

DREAM_PROMPT="You are Overlord running the nightly dream cycle. Your job is to review and consolidate the memory system.

Current memory stats:
$MEM_STATS

Auto-memory files (excluding index): $AUTO_FILES

Current MEMORY.md index (first 100 lines):
$(head -100 <<< "$MEMORY_MD")

Tasks:
1. Review the MEMORY.md index for stale, duplicate, or contradictory entries
2. If any auto-memory files exist in $MEMORY_DIR, review them for:
   - Stale info that's no longer true
   - Duplicates that should be merged
   - Missing context that should be added
3. Check if any important patterns from recent sessions should be captured
4. Report a brief dream summary: what was cleaned, what was kept, any concerns

Rules:
- Only make changes if genuinely needed — don't churn for the sake of it
- Don't create new memory files unless there's a clear gap
- Be concise in your report
- If everything looks healthy, just say so

Output your dream report as plain text."

log "[PHASE2] Running AI dream review..."
PHASE2_OUT=$(cd /root && claude -p "$DREAM_PROMPT" --model default 2>&1) || true

if [ -n "$PHASE2_OUT" ]; then
  log "[PHASE2] AI Dream Report:"
  echo "$PHASE2_OUT" >> "$LOG_FILE"
else
  log "[PHASE2] No output from AI review"
fi

log "[DONE] Dream cycle complete"

# Trim log to last 500 lines
tail -500 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
