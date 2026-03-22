---
name: github
description: Manage GitHub accounts, repos, issues, PRs, actions, gists, and notifications. Dual-account support for bluemele (projects) and overlordforthew (public/community). Use when user says "github", "repo", "PR", "issue", "gist", or references GitHub operations.
argument-hint: <action> [args]
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent
---

## GitHub Skill

Dual-account GitHub management via `gh` CLI. Execute the requested action — don't just reference docs.

### Accounts

| Account | Purpose | Scopes |
|---------|---------|--------|
| **bluemele** | All project repos (Overlord, NamiBarden, BeastMode, etc.) | repo, gist, read:org |
| **overlordforthew** | Public/community account | repo, gist, read:org |

### Quick Reference — Scripts

| Script | What it does |
|---|---|
| `bash scripts/gh-account.sh status` | Show both accounts and active status |
| `bash scripts/gh-account.sh switch <user>` | Switch active account |
| `bash scripts/gh-account.sh run <user> <gh args...>` | Run gh command as specific user |
| `bash scripts/gh-dash.sh overview` | Full dashboard for active account |
| `bash scripts/gh-dash.sh repos [user]` | List repos |
| `bash scripts/gh-dash.sh prs [user]` | List open PRs |
| `bash scripts/gh-dash.sh issues [user]` | List open issues |
| `bash scripts/gh-dash.sh actions <owner/repo>` | Workflow run history |
| `bash scripts/gh-dash.sh notifications` | Unread notifications |
| `bash scripts/gh-repo.sh create <name> [--private\|--public] [--account <user>]` | Create repo |
| `bash scripts/gh-repo.sh clone <owner/repo> [path]` | Clone repo |
| `bash scripts/gh-repo.sh info <owner/repo>` | Repo details |
| `bash scripts/gh-repo.sh setup-coolify <owner/repo>` | Webhook setup instructions |

All scripts at `/root/.claude/skills/github/scripts/`.

### How to Do Anything

#### 1. Account Management

```bash
# Check both accounts
gh auth status

# Switch active account
gh auth switch --user bluemele
gh auth switch --user overlordforthew

# Run as specific account without switching
bash /root/.claude/skills/github/scripts/gh-account.sh run overlordforthew repo list
```

#### 2. Repos

```bash
# List repos
gh repo list bluemele --limit 20
gh repo list overlordforthew --limit 20

# Create repo (as active account)
gh repo create MyNewProject --private --clone

# Create repo as specific account
bash /root/.claude/skills/github/scripts/gh-account.sh run overlordforthew repo create MyProject --private

# View repo
gh repo view bluemele/Overlord

# Clone
gh repo clone bluemele/NamiBarden /root/projects/NamiBarden

# Delete (requires --yes flag, be careful)
gh repo delete owner/repo --yes

# Fork
gh repo fork owner/repo --clone

# Repo settings
gh repo edit owner/repo --description "New description" --visibility private
```

#### 3. Issues

```bash
# List issues
gh issue list --repo bluemele/Overlord
gh issue list --repo bluemele/Overlord --state closed --limit 5

# Create issue
gh issue create --repo bluemele/Overlord --title "Bug: something broken" --body "Details here"

# View/comment
gh issue view 42 --repo bluemele/Overlord
gh issue comment 42 --repo bluemele/Overlord --body "Fixed in commit abc123"

# Close
gh issue close 42 --repo bluemele/Overlord

# Labels
gh label list --repo bluemele/Overlord
gh issue edit 42 --repo bluemele/Overlord --add-label "bug"

# Search issues across all repos
gh search issues "memory leak" --owner=bluemele
```

#### 4. Pull Requests

```bash
# List PRs
gh pr list --repo bluemele/Overlord

# Create PR
gh pr create --repo bluemele/Overlord --title "Add feature X" --body "Description" --base main

# View/review
gh pr view 10 --repo bluemele/Overlord
gh pr diff 10 --repo bluemele/Overlord
gh pr checks 10 --repo bluemele/Overlord

# Merge
gh pr merge 10 --repo bluemele/Overlord --squash --delete-branch

# Review
gh pr review 10 --repo bluemele/Overlord --approve
gh pr review 10 --repo bluemele/Overlord --comment --body "Looks good"

# Comments
gh api repos/bluemele/Overlord/pulls/10/comments
```

#### 5. GitHub Actions

```bash
# List workflow runs
gh run list --repo bluemele/BeastMode --limit 10

# View specific run
gh run view <run-id> --repo bluemele/BeastMode

# View logs
gh run view <run-id> --repo bluemele/BeastMode --log

# Trigger workflow
gh workflow run deploy.yml --repo bluemele/BeastMode

# List workflows
gh workflow list --repo bluemele/BeastMode
```

#### 6. Gists

```bash
# List gists
gh gist list

# Create gist
gh gist create file.txt --public --desc "My snippet"
echo "code here" | gh gist create --filename snippet.py --public

# View/edit
gh gist view <id>
gh gist edit <id>
```

#### 7. Releases

```bash
# List releases
gh release list --repo bluemele/Overlord

# Create release
gh release create v1.0.0 --repo bluemele/Overlord --title "v1.0.0" --notes "Release notes"

# Upload assets
gh release upload v1.0.0 ./dist/app.zip --repo bluemele/Overlord
```

#### 8. Notifications

```bash
# List unread
gh api notifications --jq '.[] | "\(.repository.full_name) \(.subject.type): \(.subject.title)"'

# Mark as read
gh api notifications --method PUT -f read=true
```

#### 9. Raw API Access

```bash
# GET
gh api repos/bluemele/Overlord

# POST
gh api repos/bluemele/Overlord/issues --method POST -f title="New issue" -f body="Details"

# GraphQL
gh api graphql -f query='{ viewer { login repositories(first: 5) { nodes { name } } } }'

# Paginated
gh api repos/bluemele/Overlord/commits --paginate --jq '.[].sha'
```

### Git Push Auth (for bluemele repos)

The `gh auth` token lacks push scope for bluemele. Use GH_TOKEN from env:

```bash
source /root/overlord/.env
git remote set-url origin "https://bluemele:${GH_TOKEN}@github.com/bluemele/REPO.git"
git push
```

### New Project Workflow

Standard flow for creating a new project under bluemele:

```bash
# 1. Create repo
gh auth switch --user bluemele
gh repo create ProjectName --private

# 2. Init local
cd /root/projects
mkdir ProjectName && cd ProjectName
git init
# ... add code ...
git add . && git commit -m "Initial commit"

# 3. Push (using GH_TOKEN for push auth)
source /root/overlord/.env
git remote add origin "https://bluemele:${GH_TOKEN}@github.com/bluemele/ProjectName.git"
git push -u origin main

# 4. Set up Coolify (if auto-deploy needed)
# Add webhook in Coolify dashboard, or manually:
bash /root/.claude/skills/github/scripts/gh-repo.sh setup-coolify bluemele/ProjectName
```

### Key Details

| Item | Value |
|------|-------|
| Config file | `~/.config/gh/hosts.yml` |
| Active account | `gh api user --jq '.login'` |
| bluemele repos | `/root/projects/` + `/root/overlord/` |
| Push auth | GH_TOKEN in `/root/overlord/.env` |
| Scopes (both) | repo, gist, read:org |
