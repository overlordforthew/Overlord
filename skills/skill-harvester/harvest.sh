#!/bin/bash
# harvest.sh — Full pipeline: clone → analyze → prepare for LLM extraction
# Usage: harvest.sh <github-url> [--quick]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_URL="${1:-}"
QUICK_FLAG=""

for arg in "$@"; do
  [ "$arg" = "--quick" ] && QUICK_FLAG="--quick"
done

if [ -z "$REPO_URL" ]; then
  echo "Usage: harvest.sh <github-url> [--quick]"
  echo ""
  echo "Full pipeline:"
  echo "  1. Clone/update repo"
  echo "  2. Analyze structure"
  echo "  3. Output analysis for LLM skill extraction"
  exit 1
fi

echo "=== SKILL HARVESTER ==="
echo "Target: $REPO_URL"
echo ""

# Step 1: Analyze
"$SCRIPT_DIR/repo-analyzer.sh" "$REPO_URL" $QUICK_FLAG

# Step 2: Prepare extraction
REPO_SLUG=$(echo "$REPO_URL" | sed -E 's|https?://github\.com/||' | sed 's|\.git$||' | sed 's|/$||')
REPO_NAME=$(echo "$REPO_SLUG" | tr '/' '-')
REPO_PATH="/tmp/repos/$REPO_NAME"

echo ""
echo "=== READY FOR EXTRACTION ==="
echo "Analysis at: $REPO_PATH/ANALYSIS_RAW.txt"
echo ""
echo "To extract skills, run:"
echo "  $SCRIPT_DIR/skill-extract.sh $REPO_PATH [--stage]"
echo ""
echo "Or have Claude read ANALYSIS_RAW.txt and generate SKILL.md drafts directly."
