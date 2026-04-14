#!/bin/bash
# git-intelligence — Cross-repo git analytics, dependency auditing, and security scanning
# Usage: git-intel.sh <command> [args...]
set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────

REPOS=(
  "/root/overlord"
  "/root/projects/NamiBarden"
  "/root/projects/MasterCommander"
  "/root/projects/BeastMode"
  "/root/projects/Lumina"
  "/root/projects/SurfaBabe"
  "/root/projects/Elmo"
  "/root/projects/OnlyHulls"
)

# Load GH_TOKEN from overlord .env
if [ -f /root/overlord/.env ]; then
  GH_TOKEN=$(grep -E '^GH_TOKEN=' /root/overlord/.env | cut -d'=' -f2- | tr -d '"' | tr -d "'")
  export GH_TOKEN
fi

GH_OWNER="bluemele"
GH_API="https://api.github.com"

# ── HELPERS ───────────────────────────────────────────────────────────────────

repo_name() {
  basename "$1"
}

divider() {
  printf '%.0s─' {1..72}
  echo
}

section() {
  echo ""
  divider
  echo "  $1"
  divider
}

# Check if a repo directory exists and is a git repo
valid_repo() {
  local dir="$1"
  [ -d "$dir/.git" ] || return 1
}

# ── COMMANDS ──────────────────────────────────────────────────────────────────

cmd_status() {
  section "GIT STATUS — All Repos"
  printf "%-20s %-15s %-12s %-10s %s\n" "PROJECT" "BRANCH" "DIRTY" "AHEAD" "BEHIND"
  printf "%-20s %-15s %-12s %-10s %s\n" "-------" "------" "-----" "-----" "------"

  for dir in "${REPOS[@]}"; do
    local name
    name=$(repo_name "$dir")
    if ! valid_repo "$dir"; then
      printf "%-20s %s\n" "$name" "(not a git repo)"
      continue
    fi

    local branch dirty ahead behind
    branch=$(git -C "$dir" branch --show-current 2>/dev/null || echo "detached")

    local status_count
    status_count=$(git -C "$dir" status --porcelain 2>/dev/null | wc -l)
    if [ "$status_count" -gt 0 ]; then
      dirty="${status_count} files"
    else
      dirty="clean"
    fi

    # Fetch silently for accurate ahead/behind
    git -C "$dir" fetch --quiet 2>/dev/null || true

    local upstream
    upstream=$(git -C "$dir" rev-parse --abbrev-ref "@{upstream}" 2>/dev/null || echo "")
    if [ -n "$upstream" ]; then
      ahead=$(git -C "$dir" rev-list --count "@{upstream}..HEAD" 2>/dev/null || echo "?")
      behind=$(git -C "$dir" rev-list --count "HEAD..@{upstream}" 2>/dev/null || echo "?")
    else
      ahead="-"
      behind="-"
    fi

    printf "%-20s %-15s %-12s %-10s %s\n" "$name" "$branch" "$dirty" "$ahead" "$behind"
  done
  echo ""
}

cmd_deps() {
  local target="${1:-all}"

  if [ "$target" = "all" ]; then
    section "DEPENDENCY AUDIT — All Repos"
    for dir in "${REPOS[@]}"; do
      _audit_one "$dir"
    done
  else
    # Accept a directory path or project name
    local dir="$target"
    if [ ! -d "$dir" ]; then
      # Try matching by name
      for d in "${REPOS[@]}"; do
        if [ "$(repo_name "$d")" = "$target" ] || [ "$(repo_name "$d" | tr '[:upper:]' '[:lower:]')" = "$(echo "$target" | tr '[:upper:]' '[:lower:]')" ]; then
          dir="$d"
          break
        fi
      done
    fi
    if [ ! -d "$dir" ]; then
      echo "ERROR: Directory not found: $target"
      return 1
    fi
    section "DEPENDENCY AUDIT — $(repo_name "$dir")"
    _audit_one "$dir"
  fi
}

_audit_one() {
  local dir="$1"
  local name
  name=$(repo_name "$dir")

  if [ ! -f "$dir/package.json" ]; then
    echo "  $name: no package.json (skipped)"
    echo ""
    return
  fi

  echo "  $name:"

  # Install deps if node_modules missing
  if [ ! -d "$dir/node_modules" ]; then
    echo "    (installing dependencies...)"
    (cd "$dir" && npm install --silent 2>/dev/null) || true
  fi

  local audit_output
  audit_output=$(cd "$dir" && npm audit --json 2>/dev/null || true)

  if [ -z "$audit_output" ] || ! echo "$audit_output" | jq . >/dev/null 2>&1; then
    echo "    Could not run npm audit"
    echo ""
    return
  fi

  # npm audit JSON structure varies by version; handle both
  local total critical high moderate low
  if echo "$audit_output" | jq -e '.metadata.vulnerabilities' >/dev/null 2>&1; then
    critical=$(echo "$audit_output" | jq '.metadata.vulnerabilities.critical // 0')
    high=$(echo "$audit_output" | jq '.metadata.vulnerabilities.high // 0')
    moderate=$(echo "$audit_output" | jq '.metadata.vulnerabilities.moderate // 0')
    low=$(echo "$audit_output" | jq '.metadata.vulnerabilities.low // 0')
    total=$(echo "$audit_output" | jq '.metadata.vulnerabilities.total // 0')
  elif echo "$audit_output" | jq -e '.vulnerabilities' >/dev/null 2>&1; then
    critical=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "critical")] | length')
    high=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "high")] | length')
    moderate=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "moderate")] | length')
    low=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "low")] | length')
    total=$((critical + high + moderate + low))
  else
    echo "    No vulnerabilities data found"
    echo ""
    return
  fi

  if [ "$total" -eq 0 ]; then
    echo "    No vulnerabilities found"
  else
    printf "    Total: %d | Critical: %d | High: %d | Moderate: %d | Low: %d\n" \
      "$total" "$critical" "$high" "$moderate" "$low"
  fi
  echo ""
}

cmd_stale() {
  section "STALE BRANCHES — Older than 30 days"
  local cutoff
  cutoff=$(date -d '30 days ago' +%s 2>/dev/null || date -v-30d +%s 2>/dev/null)

  printf "%-20s %-25s %-15s %s\n" "PROJECT" "BRANCH" "LAST COMMIT" "AUTHOR"
  printf "%-20s %-25s %-15s %s\n" "-------" "------" "-----------" "------"

  local stale_output=""

  for dir in "${REPOS[@]}"; do
    local name
    name=$(repo_name "$dir")
    if ! valid_repo "$dir"; then
      continue
    fi

    # Fetch remote branches
    git -C "$dir" fetch --quiet --prune 2>/dev/null || true

    # Check all local and remote branches
    while IFS='|' read -r branch epoch datestr author; do
      # Skip HEAD pointer
      [[ "$branch" == */HEAD ]] && continue
      if [ -n "$epoch" ] && [ "$epoch" -lt "$cutoff" ]; then
        local line
        line=$(printf "%-20s %-25s %-15s %s" "$name" "$branch" "$datestr" "$author")
        echo "$line"
        stale_output="found"
      fi
    done < <(git -C "$dir" for-each-ref --format='%(refname:short)|%(committerdate:unix)|%(committerdate:short)|%(authorname)' refs/heads/ refs/remotes/origin/ 2>/dev/null)
  done

  if [ -z "$stale_output" ]; then
    echo "  No stale branches found."
  fi
  echo ""
}

cmd_activity() {
  local days=7
  # Parse --days flag
  while [ $# -gt 0 ]; do
    case "$1" in
      --days) days="$2"; shift 2 ;;
      --days=*) days="${1#--days=}"; shift ;;
      *) days="$1"; shift ;;
    esac
  done

  section "COMMIT ACTIVITY — Last ${days} days"
  local since
  since=$(date -d "${days} days ago" --iso-8601 2>/dev/null || date -v-${days}d +%Y-%m-%d 2>/dev/null)

  local total_commits=0

  for dir in "${REPOS[@]}"; do
    local name
    name=$(repo_name "$dir")
    if ! valid_repo "$dir"; then
      continue
    fi

    local commits
    commits=$(git -C "$dir" log --since="$since" --oneline 2>/dev/null | wc -l)
    if [ "$commits" -eq 0 ]; then
      continue
    fi

    total_commits=$((total_commits + commits))
    echo ""
    echo "  $name ($commits commits):"
    git -C "$dir" log --since="$since" -20 --format="    %C(yellow)%h%Creset %C(green)%ad%Creset %s %C(blue)<%an>%Creset" --date=short 2>/dev/null || true
    if [ "$commits" -gt 20 ]; then
      echo "    ... and $((commits - 20)) more"
    fi
  done

  echo ""
  echo "  Total: $total_commits commits across all repos in last ${days} days"
  echo ""
}

cmd_size() {
  section "REPO SIZES"
  printf "%-20s %-12s %-10s %-12s %s\n" "PROJECT" "DISK" "COMMITS" ".GIT SIZE" "LARGEST FILE"
  printf "%-20s %-12s %-10s %-12s %s\n" "-------" "----" "-------" "---------" "------------"

  for dir in "${REPOS[@]}"; do
    local name
    name=$(repo_name "$dir")
    if ! valid_repo "$dir"; then
      printf "%-20s %s\n" "$name" "(not a git repo)"
      continue
    fi

    local disk commits gitsize largest

    disk=$(du -sh "$dir" 2>/dev/null | cut -f1)
    commits=$(git -C "$dir" rev-list --count HEAD 2>/dev/null || echo "?")
    gitsize=$(du -sh "$dir/.git" 2>/dev/null | cut -f1)

    # Find largest tracked file
    largest=$(cd "$dir" && git ls-files -z 2>/dev/null | \
      xargs -0 stat --format='%s %n' 2>/dev/null | \
      sort -rn | head -1 | awk '{
        size=$1; fname=$2;
        for(i=3;i<=NF;i++) fname=fname" "$i;
        if (size > 1048576) printf "%.1fM %s", size/1048576, fname;
        else if (size > 1024) printf "%.0fK %s", size/1024, fname;
        else printf "%dB %s", size, fname;
      }' 2>/dev/null || echo "?")

    printf "%-20s %-12s %-10s %-12s %s\n" "$name" "$disk" "$commits" "$gitsize" "$largest"
  done
  echo ""
}

cmd_security() {
  section "SECURITY SCAN"

  echo ""
  echo "=== npm audit ==="
  echo ""
  local has_vulns=0

  for dir in "${REPOS[@]}"; do
    local name
    name=$(repo_name "$dir")
    if [ ! -f "$dir/package.json" ]; then
      continue
    fi

    if [ ! -d "$dir/node_modules" ]; then
      (cd "$dir" && npm install --silent 2>/dev/null) || true
    fi

    local audit_output
    audit_output=$(cd "$dir" && npm audit --json 2>/dev/null || true)

    if [ -z "$audit_output" ] || ! echo "$audit_output" | jq . >/dev/null 2>&1; then
      continue
    fi

    local total=0
    if echo "$audit_output" | jq -e '.metadata.vulnerabilities' >/dev/null 2>&1; then
      total=$(echo "$audit_output" | jq '.metadata.vulnerabilities.total // 0')
    elif echo "$audit_output" | jq -e '.vulnerabilities' >/dev/null 2>&1; then
      total=$(echo "$audit_output" | jq '[.vulnerabilities[]] | length')
    fi

    if [ "$total" -gt 0 ]; then
      has_vulns=1
      local critical high moderate
      if echo "$audit_output" | jq -e '.metadata.vulnerabilities' >/dev/null 2>&1; then
        critical=$(echo "$audit_output" | jq '.metadata.vulnerabilities.critical // 0')
        high=$(echo "$audit_output" | jq '.metadata.vulnerabilities.high // 0')
        moderate=$(echo "$audit_output" | jq '.metadata.vulnerabilities.moderate // 0')
      else
        critical=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "critical")] | length')
        high=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "high")] | length')
        moderate=$(echo "$audit_output" | jq '[.vulnerabilities[] | select(.severity == "moderate")] | length')
      fi
      printf "  %-20s %d total (critical:%d high:%d moderate:%d)\n" "$name" "$total" "$critical" "$high" "$moderate"
    fi
  done

  if [ "$has_vulns" -eq 0 ]; then
    echo "  No npm vulnerabilities found across any project."
  fi

  echo ""
  echo "=== Secret Leak Scan (last 20 commits) ==="
  echo ""

  local leak_found=0
  local secret_patterns='(password|passwd|pwd)\s*=|secret\s*=|api_key\s*=|apikey\s*=|token\s*=|private_key|PRIVATE KEY'

  for dir in "${REPOS[@]}"; do
    local name
    name=$(repo_name "$dir")
    if ! valid_repo "$dir"; then
      continue
    fi

    # Scan last 20 commit diffs, excluding .env and lock files
    local hits
    hits=$(git -C "$dir" log -20 --diff-filter=ACMR -p -- \
      ':!*.env' ':!*.lock' ':!package-lock.json' ':!yarn.lock' ':!pnpm-lock.yaml' \
      2>/dev/null | \
      grep -ciE "$secret_patterns" 2>/dev/null || echo "0")

    if [ "$hits" -gt 0 ]; then
      leak_found=1
      # Get which commits have matches (without printing actual secrets)
      echo "  $name: $hits potential secret pattern(s) in recent commits"

      git -C "$dir" log -20 --format="%h %s" 2>/dev/null | while read -r hash msg; do
        local commit_hits
        commit_hits=$(git -C "$dir" show "$hash" -- \
          ':!*.env' ':!*.lock' ':!package-lock.json' ':!yarn.lock' ':!pnpm-lock.yaml' \
          2>/dev/null | \
          grep -ciE "$secret_patterns" 2>/dev/null || echo "0")
        if [ "$commit_hits" -gt 0 ]; then
          echo "    $hash: $commit_hits match(es) — $msg"
        fi
      done
      echo ""
    fi
  done

  if [ "$leak_found" -eq 0 ]; then
    echo "  No potential secret leaks found in recent commits."
  fi
  echo ""
}

cmd_prs() {
  section "OPEN PULL REQUESTS"

  if [ -z "${GH_TOKEN:-}" ]; then
    echo "  ERROR: GH_TOKEN not found in /root/overlord/.env"
    return 1
  fi

  local total_prs=0

  for dir in "${REPOS[@]}"; do
    local name
    name=$(repo_name "$dir")

    # Handle repo name mapping (local dir name may differ from GitHub repo name)
    local gh_repo="$name"

    local response
    response=$(curl -sf -H "Authorization: token $GH_TOKEN" \
      -H "Accept: application/vnd.github.v3+json" \
      "$GH_API/repos/$GH_OWNER/$gh_repo/pulls?state=open&per_page=50" 2>/dev/null || echo "[]")

    # Check for API error
    if ! echo "$response" | jq -e '.[0]' >/dev/null 2>&1; then
      # No PRs or repo not found
      local pr_count
      pr_count=$(echo "$response" | jq 'length' 2>/dev/null || echo "0")
      if [ "$pr_count" = "0" ]; then
        continue
      fi
    fi

    local pr_count
    pr_count=$(echo "$response" | jq 'length' 2>/dev/null || echo "0")
    if [ "$pr_count" -eq 0 ]; then
      continue
    fi

    total_prs=$((total_prs + pr_count))
    echo ""
    echo "  $name ($pr_count open):"

    echo "$response" | jq -r '.[] | "    #\(.number) \(.title) [\(.user.login)] (\(.created_at | split("T")[0]))"' 2>/dev/null
  done

  echo ""
  if [ "$total_prs" -eq 0 ]; then
    echo "  No open PRs across any repos."
  else
    echo "  Total open PRs: $total_prs"
  fi
  echo ""
}

cmd_report() {
  local date_str
  date_str=$(date '+%Y-%m-%d %H:%M')

  echo "=================================================================="
  echo "  GIT INTELLIGENCE — Weekly Digest"
  echo "  Generated: $date_str"
  echo "=================================================================="

  cmd_status
  cmd_activity --days 7
  cmd_stale
  cmd_size
  cmd_deps all
  cmd_security
  cmd_prs

  echo "=================================================================="
  echo "  END OF REPORT"
  echo "=================================================================="
}

# ── USAGE ─────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
git-intelligence — Cross-repo git analytics, auditing, and security scanning

OVERVIEW:
  git-intel.sh status                  Git status across ALL repos (branch, dirty, ahead/behind)
  git-intel.sh activity [--days 7]     Recent commit activity across all repos
  git-intel.sh stale                   Find branches with no commits in 30+ days
  git-intel.sh size                    Repo disk usage, commit counts, largest files

DEPENDENCIES:
  git-intel.sh deps [project]          npm audit for one project or all projects

SECURITY:
  git-intel.sh security                npm audit + secret leak scan across all repos
  git-intel.sh prs                     List open PRs via GitHub API (requires GH_TOKEN)

REPORTING:
  git-intel.sh report                  Full weekly digest (all commands combined)

EXAMPLES:
  git-intel.sh status
  git-intel.sh activity --days 14
  git-intel.sh deps /root/projects/BeastMode
  git-intel.sh deps Lumina
  git-intel.sh security
  git-intel.sh prs
  git-intel.sh report > /tmp/weekly-git-report.txt
USAGE
}

# ── MAIN ──────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  status)       cmd_status ;;
  deps|audit)   cmd_deps "$@" ;;
  stale)        cmd_stale ;;
  activity)     cmd_activity "$@" ;;
  size|sizes)   cmd_size ;;
  security|sec) cmd_security ;;
  prs|pr)       cmd_prs ;;
  report)       cmd_report ;;
  help|--help|-h) usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: git-intel.sh help"
    exit 1
    ;;
esac
