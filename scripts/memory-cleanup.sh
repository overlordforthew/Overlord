#!/bin/bash
# memory-cleanup.sh — Daily memory file simplification
# Runs via cron, uses free LLM to assess and simplify memory files.
# Backs up before modifying. Logs changes.

set -euo pipefail

MEMORY_DIR="/root/.claude/projects/-root/memory"
BACKUP_DIR="/root/.claude/projects/-root/memory/backups"
LOG="/tmp/memory-cleanup.log"
MODEL="openrouter/openrouter/free"
TIMESTAMP=$(date +%Y-%m-%d)

# Files to process (skip backups dir)
FILES=(
  "MEMORY.md"
  "projects.md"
  "work-log.md"
  "infrastructure.md"
  "cloudflare.md"
  "mastercommander-plans.md"
)

PROMPT='You are a memory file editor for a server management AI. Your job is to simplify and clean up this memory file.

RULES:
1. REMOVE: stale info, duplicate content, completed TODOs, historical logs that teach no lessons, verbose explanations
2. KEEP: operational details (ports, UUIDs, credentials locations), gotchas/quirks, active project status, lessons learned
3. CONDENSE: multi-line descriptions into single lines where possible
4. PRESERVE: all IDs, paths, URLs, contact info, config values — never remove technical identifiers
5. DO NOT add new information, commentary, or headers like "Simplified by..."
6. DO NOT wrap output in markdown code fences
7. If the file is already clean and concise, return it UNCHANGED
8. Output ONLY the file content, nothing else

Here is the file to process:'

echo "=== Memory Cleanup: $TIMESTAMP ===" > "$LOG"

# Create backup dir
mkdir -p "$BACKUP_DIR"

# Clean old backups (keep 7 days)
find "$BACKUP_DIR" -name "*.md.bak" -mtime +7 -delete 2>/dev/null || true

changes=0

for file in "${FILES[@]}"; do
  filepath="$MEMORY_DIR/$file"

  if [ ! -f "$filepath" ]; then
    echo "SKIP: $file (not found)" >> "$LOG"
    continue
  fi

  before_lines=$(wc -l < "$filepath")
  before_size=$(stat -c%s "$filepath")

  # Skip tiny files (< 5 lines)
  if [ "$before_lines" -lt 5 ]; then
    echo "SKIP: $file ($before_lines lines, too small)" >> "$LOG"
    continue
  fi

  # Backup
  cp "$filepath" "$BACKUP_DIR/${file}.bak"

  # Send to LLM for cleanup
  result=$(cat "$filepath" | docker exec -i overlord llm -m "$MODEL" "$PROMPT" 2>/dev/null) || {
    echo "ERROR: $file — LLM call failed, restoring backup" >> "$LOG"
    cp "$BACKUP_DIR/${file}.bak" "$filepath"
    continue
  }

  # Safety checks
  result_lines=$(echo "$result" | wc -l)

  # Don't accept if result is empty or too short (LLM hallucinated)
  if [ "$result_lines" -lt 3 ]; then
    echo "REJECT: $file — result too short ($result_lines lines), restoring" >> "$LOG"
    cp "$BACKUP_DIR/${file}.bak" "$filepath"
    continue
  fi

  # Don't accept if result lost more than 50% of lines (too aggressive)
  min_lines=$((before_lines / 2))
  if [ "$result_lines" -lt "$min_lines" ]; then
    echo "REJECT: $file — too aggressive ($before_lines → $result_lines lines), restoring" >> "$LOG"
    cp "$BACKUP_DIR/${file}.bak" "$filepath"
    continue
  fi

  # Check if content actually changed
  if diff -q "$filepath" <(echo "$result") > /dev/null 2>&1; then
    echo "CLEAN: $file — no changes needed" >> "$LOG"
    continue
  fi

  # Write result
  echo "$result" > "$filepath"
  after_lines=$(wc -l < "$filepath")
  after_size=$(stat -c%s "$filepath")

  echo "UPDATED: $file — $before_lines→$after_lines lines, ${before_size}→${after_size} bytes" >> "$LOG"
  changes=$((changes + 1))
done

echo "--- Done: $changes files modified ---" >> "$LOG"
cat "$LOG"
