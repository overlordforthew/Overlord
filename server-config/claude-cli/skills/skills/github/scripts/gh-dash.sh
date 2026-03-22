#!/bin/bash
# GitHub dashboard — overview of repos, PRs, issues, actions across accounts
# Usage:
#   gh-dash.sh repos [user]       — list repos (default: active account)
#   gh-dash.sh prs [user]         — list open PRs
#   gh-dash.sh issues [user]      — list open issues
#   gh-dash.sh actions [repo]     — list recent workflow runs
#   gh-dash.sh overview           — full dashboard for both accounts
#   gh-dash.sh notifications      — show unread notifications

case "$1" in
  repos)
    USER="${2:-}"
    if [ -n "$USER" ]; then
      gh repo list "$USER" --limit 30 --json name,isPrivate,updatedAt,description,primaryLanguage \
        --template '{{range .}}{{.name}}{{"\t"}}{{if .isPrivate}}🔒{{else}}🌐{{end}}{{"\t"}}{{.primaryLanguage.name}}{{"\t"}}{{timeago .updatedAt}}{{"\t"}}{{.description}}{{"\n"}}{{end}}'
    else
      gh repo list --limit 30 --json name,isPrivate,updatedAt,description,primaryLanguage \
        --template '{{range .}}{{.name}}{{"\t"}}{{if .isPrivate}}🔒{{else}}🌐{{end}}{{"\t"}}{{.primaryLanguage.name}}{{"\t"}}{{timeago .updatedAt}}{{"\t"}}{{.description}}{{"\n"}}{{end}}'
    fi
    ;;
  prs)
    USER="${2:-}"
    if [ -n "$USER" ]; then
      gh search prs --author="$USER" --state=open --json repository,title,updatedAt,url \
        --template '{{range .}}{{.repository.nameWithOwner}}{{"\t"}}{{.title}}{{"\t"}}{{timeago .updatedAt}}{{"\t"}}{{.url}}{{"\n"}}{{end}}'
    else
      gh pr list --state open --json title,headRefName,updatedAt,url,repository \
        --template '{{range .}}{{.title}}{{"\t"}}{{.headRefName}}{{"\t"}}{{timeago .updatedAt}}{{"\t"}}{{.url}}{{"\n"}}{{end}}' 2>/dev/null || \
      gh search prs --author=@me --state=open --json repository,title,updatedAt,url \
        --template '{{range .}}{{.repository.nameWithOwner}}{{"\t"}}{{.title}}{{"\t"}}{{timeago .updatedAt}}{{"\t"}}{{.url}}{{"\n"}}{{end}}'
    fi
    ;;
  issues)
    USER="${2:-}"
    if [ -n "$USER" ]; then
      gh search issues --author="$USER" --state=open --json repository,title,updatedAt,url \
        --template '{{range .}}{{.repository.nameWithOwner}}{{"\t"}}{{.title}}{{"\t"}}{{timeago .updatedAt}}{{"\t"}}{{.url}}{{"\n"}}{{end}}'
    else
      gh search issues --author=@me --state=open --json repository,title,updatedAt,url \
        --template '{{range .}}{{.repository.nameWithOwner}}{{"\t"}}{{.title}}{{"\t"}}{{timeago .updatedAt}}{{"\t"}}{{.url}}{{"\n"}}{{end}}'
    fi
    ;;
  actions)
    REPO="${2:-}"
    if [ -z "$REPO" ]; then
      echo "Usage: gh-dash.sh actions <owner/repo>"
      exit 1
    fi
    gh run list --repo "$REPO" --limit 10 --json status,conclusion,name,createdAt,headBranch,url \
      --template '{{range .}}{{.status}}{{"\t"}}{{.conclusion}}{{"\t"}}{{.name}}{{"\t"}}{{.headBranch}}{{"\t"}}{{timeago .createdAt}}{{"\t"}}{{.url}}{{"\n"}}{{end}}'
    ;;
  notifications)
    gh api notifications --jq '.[] | "\(.repository.full_name)\t\(.subject.type)\t\(.subject.title)\t\(.reason)\t\(.updated_at)"' 2>/dev/null | head -20
    ;;
  overview)
    echo "=== Active Account ==="
    gh api user --jq '"  \(.login) (\(.name // "no name")) — \(.public_repos) public, \(.total_private_repos // 0) private repos"' 2>/dev/null
    echo ""
    echo "=== All Accounts ==="
    gh auth status 2>&1
    echo ""
    echo "=== Recent Repos (active) ==="
    gh repo list --limit 10 --json name,isPrivate,updatedAt \
      --template '{{range .}}  {{.name}}{{"\t"}}{{if .isPrivate}}🔒{{else}}🌐{{end}}{{"\t"}}{{timeago .updatedAt}}{{"\n"}}{{end}}' 2>/dev/null
    echo ""
    echo "=== Open PRs (active) ==="
    gh search prs --author=@me --state=open --limit 5 --json repository,title \
      --template '{{range .}}  {{.repository.nameWithOwner}}: {{.title}}{{"\n"}}{{end}}' 2>/dev/null || echo "  (none)"
    echo ""
    echo "=== Notifications ==="
    COUNT=$(gh api notifications --jq 'length' 2>/dev/null)
    echo "  ${COUNT:-0} unread notifications"
    ;;
  *)
    echo "GitHub Dashboard"
    echo "  repos [user]       — list repos"
    echo "  prs [user]         — open pull requests"
    echo "  issues [user]      — open issues"
    echo "  actions <repo>     — workflow runs"
    echo "  notifications      — unread notifications"
    echo "  overview           — full dashboard"
    ;;
esac
