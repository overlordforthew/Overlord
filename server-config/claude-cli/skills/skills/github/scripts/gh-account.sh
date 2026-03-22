#!/bin/bash
# GitHub account management — switch, status, run-as
# Usage:
#   gh-account.sh status          — show both accounts
#   gh-account.sh switch <user>   — switch active account
#   gh-account.sh active          — show active account name
#   gh-account.sh run <user> <gh args...> — run a gh command as a specific account

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

case "$1" in
  status)
    gh auth status 2>&1
    ;;
  active)
    gh api user --jq '.login' 2>/dev/null
    ;;
  switch)
    if [ -z "$2" ]; then
      echo "Usage: gh-account.sh switch <bluemele|overlordforthew>"
      exit 1
    fi
    gh auth switch --user "$2" 2>&1
    echo "Active account: $(gh api user --jq '.login' 2>/dev/null)"
    ;;
  run)
    if [ -z "$2" ] || [ -z "$3" ]; then
      echo "Usage: gh-account.sh run <user> <gh command args...>"
      exit 1
    fi
    TARGET_USER="$2"
    shift 2
    # Switch, run, switch back
    ORIGINAL=$(gh api user --jq '.login' 2>/dev/null)
    if [ "$ORIGINAL" != "$TARGET_USER" ]; then
      gh auth switch --user "$TARGET_USER" 2>/dev/null
    fi
    gh "$@"
    EXIT_CODE=$?
    if [ "$ORIGINAL" != "$TARGET_USER" ]; then
      gh auth switch --user "$ORIGINAL" 2>/dev/null
    fi
    exit $EXIT_CODE
    ;;
  *)
    echo "GitHub Account Manager"
    echo "  status          — show all accounts"
    echo "  active          — show active account"
    echo "  switch <user>   — switch active account"
    echo "  run <user> ...  — run gh command as specific user"
    ;;
esac
