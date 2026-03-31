#!/usr/bin/env bash
# Guard hook: checks bash commands for destructive patterns before execution.
# Called as a PreToolUse hook on Bash tool invocations.
# Exit 0 = allow, Exit 2 = block with message (STDERR).

set -euo pipefail

INPUT=$(cat)
CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [ -z "$CMD" ]; then
  exit 0
fi

# --- Destructive patterns ---
DESTRUCTIVE_PATTERNS=(
  'rm -rf'
  'rm -r '
  'rm --recursive'
  'DROP TABLE'
  'DROP DATABASE'
  'TRUNCATE '
  'git push --force'
  'git push -f '
  'git push -f$'
  'git reset --hard'
  'git checkout \.'
  'git restore \.'
  'git clean -f'
  'git branch -D'
  'docker system prune'
  'docker rm -f'
  'docker volume rm'
  'docker network rm'
  'kill -9'
  'pkill -9'
  'systemctl stop'
  'reboot'
  'shutdown'
  'mkfs\.'
  'dd if='
)

# --- Safe exceptions (won't trigger even if they match above) ---
SAFE_PATTERNS=(
  'rm -rf node_modules'
  'rm -rf dist'
  'rm -rf build'
  'rm -rf .next'
  'rm -rf /tmp/'
  'rm -rf __pycache__'
  'docker system prune.*--filter'
  'git checkout -b'
  'git checkout -- .'  # intentional discard, user likely asked
)

# Check safe patterns first
for safe in "${SAFE_PATTERNS[@]}"; do
  if echo "$CMD" | grep -qiE "$safe"; then
    exit 0
  fi
done

# Check destructive patterns
for pattern in "${DESTRUCTIVE_PATTERNS[@]}"; do
  if echo "$CMD" | grep -qiE "$pattern"; then
    echo "GUARD: Destructive command detected: \`$pattern\`" >&2
    echo "Command: $CMD" >&2
    echo "" >&2
    echo "Override: tell the user what you're about to do and ask for confirmation." >&2
    exit 2
  fi
done

exit 0
