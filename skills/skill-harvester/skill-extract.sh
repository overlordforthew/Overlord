#!/bin/bash
# skill-extract.sh — Generate SKILL.md drafts from repo analysis
# Usage: skill-extract.sh <repo-path> [--skill <name>] [--stage]
set -euo pipefail

REPO_PATH="${1:-}"
SPECIFIC_SKILL=""
STAGE=false
DRAFTS_DIR="/tmp/skill-drafts"

shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --skill) SPECIFIC_SKILL="$2"; shift 2 ;;
    --stage) STAGE=true; shift ;;
    *) shift ;;
  esac
done

if [ -z "$REPO_PATH" ]; then
  echo "Usage: skill-extract.sh <repo-path> [--skill <name>] [--stage]"
  exit 1
fi

ANALYSIS_FILE="$REPO_PATH/ANALYSIS_RAW.txt"
if [ ! -f "$ANALYSIS_FILE" ]; then
  echo "ERROR: No ANALYSIS_RAW.txt found at $REPO_PATH"
  echo "Run repo-analyzer.sh first."
  exit 1
fi

REPO_NAME=$(basename "$REPO_PATH")
mkdir -p "$DRAFTS_DIR"

echo "Reading analysis for $REPO_NAME..."
echo ""
echo "=== ANALYSIS DATA ==="
cat "$ANALYSIS_FILE"
echo ""
echo "=== END ANALYSIS ==="
echo ""
echo "INSTRUCTION: Use Claude to read the analysis above and generate SKILL.md drafts."
echo ""
echo "For each identified skill, write the draft to:"
echo "  $DRAFTS_DIR/<skill-name>/SKILL.md"
echo ""

if [ "$STAGE" = true ]; then
  echo "STAGING MODE: Approved drafts will also be copied to /projects/Overlord/skills/<skill-name>/DRAFT-SKILL.md"
fi

if [ -n "$SPECIFIC_SKILL" ]; then
  echo "FILTER: Only extracting skill '$SPECIFIC_SKILL'"
fi

echo ""
echo "The LLM should:"
echo "1. Identify skill-worthy components from the analysis"
echo "2. Rate relevance (high/medium/low) for Overlord's stack"
echo "3. Generate SKILL.md for high/medium relevance items"
echo "4. Skip components that duplicate existing skills"
echo "5. Note any dependencies we'd need to install"
echo ""
echo "Existing Overlord skills (avoid duplicates):"
ls /app/skills/ 2>/dev/null || ls /projects/Overlord/skills/ 2>/dev/null || echo "(unable to list)"
