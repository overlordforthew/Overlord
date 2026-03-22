#!/bin/bash
# GitHub repo operations — create, clone, setup for Coolify
# Usage:
#   gh-repo.sh create <name> [--private] [--public] [--account <user>]
#   gh-repo.sh clone <owner/repo> [path]
#   gh-repo.sh info <owner/repo>
#   gh-repo.sh setup-coolify <owner/repo>  — add webhook for Coolify auto-deploy
#   gh-repo.sh delete <owner/repo>         — delete repo (with confirmation)

ACCOUNT=""
VISIBILITY="--private"

# Parse --account flag from any position
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --account) ACCOUNT="$2"; shift 2 ;;
    --private) VISIBILITY="--private"; shift ;;
    --public) VISIBILITY="--public"; shift ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- "${ARGS[@]}"

run_gh() {
  if [ -n "$ACCOUNT" ]; then
    ORIGINAL=$(gh api user --jq '.login' 2>/dev/null)
    if [ "$ORIGINAL" != "$ACCOUNT" ]; then
      gh auth switch --user "$ACCOUNT" 2>/dev/null
    fi
    gh "$@"
    local rc=$?
    if [ "$ORIGINAL" != "$ACCOUNT" ]; then
      gh auth switch --user "$ORIGINAL" 2>/dev/null
    fi
    return $rc
  else
    gh "$@"
  fi
}

case "$1" in
  create)
    NAME="$2"
    if [ -z "$NAME" ]; then
      echo "Usage: gh-repo.sh create <name> [--private|--public] [--account <user>]"
      exit 1
    fi
    OWNER=$([ -n "$ACCOUNT" ] && echo "$ACCOUNT" || gh api user --jq '.login' 2>/dev/null)
    echo "Creating repo ${OWNER}/${NAME} (${VISIBILITY#--})..."
    run_gh repo create "$NAME" "$VISIBILITY" --clone
    echo ""
    echo "Repo created: https://github.com/${OWNER}/${NAME}"
    ;;
  clone)
    REPO="$2"
    DEST="${3:-}"
    if [ -z "$REPO" ]; then
      echo "Usage: gh-repo.sh clone <owner/repo> [path]"
      exit 1
    fi
    if [ -n "$DEST" ]; then
      run_gh repo clone "$REPO" "$DEST"
    else
      run_gh repo clone "$REPO"
    fi
    ;;
  info)
    REPO="$2"
    if [ -z "$REPO" ]; then
      echo "Usage: gh-repo.sh info <owner/repo>"
      exit 1
    fi
    run_gh repo view "$REPO" --json name,owner,isPrivate,defaultBranchRef,description,url,createdAt,pushedAt,languages,diskUsage \
      --template '{{.owner.login}}/{{.name}}
  URL:         {{.url}}
  Private:     {{.isPrivate}}
  Branch:      {{.defaultBranchRef.name}}
  Created:     {{.createdAt}}
  Last push:   {{.pushedAt}}
  Size:        {{.diskUsage}}KB
  Description: {{.description}}
  Languages:   {{range .languages}}{{.node.name}} {{end}}
'
    ;;
  setup-coolify)
    REPO="$2"
    if [ -z "$REPO" ]; then
      echo "Usage: gh-repo.sh setup-coolify <owner/repo>"
      exit 1
    fi
    # Get Coolify webhook URL from env
    source /root/overlord/.env 2>/dev/null
    if [ -z "$WEBHOOK_TOKEN" ]; then
      echo "ERROR: WEBHOOK_TOKEN not found in /root/overlord/.env"
      exit 1
    fi
    WEBHOOK_URL="https://coolify.namibarden.com/api/v1/deploy?token=${WEBHOOK_TOKEN}&uuid=REPLACE_WITH_APP_UUID"
    echo "To set up Coolify webhook for ${REPO}:"
    echo "1. Get the app UUID from Coolify dashboard"
    echo "2. Run:"
    echo "   gh api repos/${REPO}/hooks --method POST -f url='${WEBHOOK_URL}' -f content_type=json -F active=true -f events[]=push"
    echo ""
    echo "Or add webhook manually in GitHub repo Settings > Webhooks"
    ;;
  delete)
    REPO="$2"
    if [ -z "$REPO" ]; then
      echo "Usage: gh-repo.sh delete <owner/repo>"
      exit 1
    fi
    echo "⚠️  This will PERMANENTLY delete ${REPO}!"
    echo "Run manually: gh repo delete ${REPO} --yes"
    ;;
  *)
    echo "GitHub Repo Manager"
    echo "  create <name> [--private|--public] [--account <user>]"
    echo "  clone <owner/repo> [path]"
    echo "  info <owner/repo>"
    echo "  setup-coolify <owner/repo>"
    echo "  delete <owner/repo>"
    ;;
esac
