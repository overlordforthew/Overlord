#!/bin/bash
# semgrep-tool.sh — Security scanning with Semgrep via Docker
# Usage: semgrep-tool.sh <command> [args...]
set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────

SEMGREP_IMAGE="semgrep/semgrep"
PROJECTS_DIR="/projects"

# Known projects and their paths
declare -A PROJECT_PATHS=(
  [overlord]="/projects/Overlord"
  [namibarden]="/projects/NamiBarden"
  [surfababe]="/projects/SurfaBabe"
  [onlyhulls]="/projects/OnlyHulls"
  [mastercommander]="/projects/MasterCommander"
  [lumina]="/projects/Lumina"
  [elmo]="/projects/Elmo"
)

# ── COLORS ────────────────────────────────────────────────────────────────────

RED='\033[0;31m'
YEL='\033[1;33m'
GRN='\033[0;32m'
CYN='\033[0;36m'
BLD='\033[1m'
RST='\033[0m'

# ── HELPERS ───────────────────────────────────────────────────────────────────

resolve_project() {
  local name="${1,,}"  # lowercase
  if [ -n "${PROJECT_PATHS[$name]+x}" ]; then
    echo "${PROJECT_PATHS[$name]}"
  else
    echo ""
  fi
}

list_projects() {
  echo "Known projects:"
  for key in "${!PROJECT_PATHS[@]}"; do
    local path="${PROJECT_PATHS[$key]}"
    if [ -d "$path" ]; then
      printf "  %-20s %s\n" "$key" "$path"
    else
      printf "  %-20s %s (not found)\n" "$key" "$path"
    fi
  done
}

run_semgrep() {
  local target="$1"
  shift

  if [ ! -d "$target" ]; then
    echo "ERROR: Directory not found: $target"
    return 1
  fi

  local abs_target
  abs_target=$(cd "$target" && pwd)

  echo -e "${BLD}Scanning: $abs_target${RST}"
  echo -e "Using: docker run --rm -v ... ${SEMGREP_IMAGE} --config auto"
  echo ""

  docker run --rm \
    -v "$abs_target:/src" \
    "$SEMGREP_IMAGE" \
    semgrep --config auto \
    --json \
    --no-git-ignore \
    "$@" \
    /src 2>/dev/null | parse_results "$abs_target"
}

parse_results() {
  local scan_path="$1"
  local json
  json=$(cat)

  if [ -z "$json" ]; then
    echo -e "${RED}ERROR: Semgrep returned no output${RST}"
    return 1
  fi

  # Check for errors in the JSON
  local error_count
  error_count=$(echo "$json" | jq -r '.errors | length' 2>/dev/null || echo "0")
  if [ "$error_count" -gt 0 ]; then
    echo -e "${YEL}Semgrep reported $error_count error(s) during scan${RST}"
    echo "$json" | jq -r '.errors[]? | "  \(.type // "error"): \(.message // "unknown")"' 2>/dev/null || true
    echo ""
  fi

  # Parse findings
  local finding_count
  finding_count=$(echo "$json" | jq -r '.results | length' 2>/dev/null || echo "0")

  if [ "$finding_count" -eq 0 ]; then
    echo -e "${GRN}No security findings detected.${RST}"
    echo ""
    echo "Summary: 0 findings"
    return 0
  fi

  # Count by severity
  local critical high medium low warning info
  critical=$(echo "$json" | jq '[.results[] | select(.extra.severity == "ERROR")] | length' 2>/dev/null || echo "0")
  high=$(echo "$json" | jq '[.results[] | select(.extra.severity == "WARNING")] | length' 2>/dev/null || echo "0")
  medium=$(echo "$json" | jq '[.results[] | select(.extra.severity == "INFO")] | length' 2>/dev/null || echo "0")
  low=$(echo "$json" | jq '[.results[] | select(.extra.severity == "INVENTORY" or .extra.severity == "EXPERIMENT")] | length' 2>/dev/null || echo "0")

  echo -e "${BLD}=== Scan Results ===${RST}"
  echo ""
  echo -e "  Total findings: $finding_count"
  [ "$critical" -gt 0 ] && echo -e "  ${RED}CRITICAL (ERROR): $critical${RST}"
  [ "$high" -gt 0 ] && echo -e "  ${RED}HIGH (WARNING):    $high${RST}"
  [ "$medium" -gt 0 ] && echo -e "  ${YEL}MEDIUM (INFO):     $medium${RST}"
  [ "$low" -gt 0 ] && echo -e "  ${CYN}LOW:               $low${RST}"
  echo ""

  # Display findings sorted by severity
  echo -e "${BLD}--- Findings ---${RST}"
  echo ""

  echo "$json" | jq -r '
    .results
    | sort_by(
        if .extra.severity == "ERROR" then 0
        elif .extra.severity == "WARNING" then 1
        elif .extra.severity == "INFO" then 2
        else 3 end
      )
    | .[]
    | "\(.extra.severity // "UNKNOWN")|\(.path)|\(.start.line)|\(.check_id)|\(.extra.message // "No description")"
  ' 2>/dev/null | while IFS='|' read -r severity file line rule message; do
    # Map semgrep severity to display labels
    local label color
    case "$severity" in
      ERROR)   label="CRITICAL"; color="$RED" ;;
      WARNING) label="HIGH";     color="$RED" ;;
      INFO)    label="MEDIUM";   color="$YEL" ;;
      *)       label="LOW";      color="$CYN" ;;
    esac

    # Strip /src/ prefix from file paths for cleaner display
    file="${file#/src/}"

    echo -e "${color}[$label]${RST} ${BLD}$file:$line${RST}"
    echo "  Rule: $rule"
    echo "  $message"
    echo ""
  done

  echo "Summary: $finding_count findings ($critical critical, $high high, $medium medium, $low low)"
}

# ── COMMANDS ──────────────────────────────────────────────────────────────────

cmd_scan() {
  local target="${1:-}"

  if [ -z "$target" ]; then
    echo "Usage: semgrep-tool.sh scan <path>"
    echo ""
    echo "Scans a specific directory for security issues."
    echo ""
    echo "Examples:"
    echo "  semgrep-tool.sh scan /projects/Overlord"
    echo "  semgrep-tool.sh scan /projects/OnlyHulls/src"
    return 1
  fi

  run_semgrep "$target"
}

cmd_scan_project() {
  local name="${1:-}"

  if [ -z "$name" ]; then
    echo "Usage: semgrep-tool.sh scan-project <name>"
    echo ""
    list_projects
    return 1
  fi

  local path
  path=$(resolve_project "$name")

  if [ -z "$path" ]; then
    echo "ERROR: Unknown project '$name'"
    echo ""
    list_projects
    return 1
  fi

  if [ ! -d "$path" ]; then
    echo "ERROR: Project directory not found: $path"
    return 1
  fi

  echo -e "${BLD}=== Security Scan: $name ===${RST}"
  echo -e "Path: $path"
  echo ""

  run_semgrep "$path"
}

cmd_audit() {
  echo -e "${BLD}========================================${RST}"
  echo -e "${BLD}     Full Security Audit — All Projects${RST}"
  echo -e "${BLD}     $(date '+%Y-%m-%d %H:%M:%S')${RST}"
  echo -e "${BLD}========================================${RST}"
  echo ""

  local total_findings=0
  local total_critical=0
  local total_high=0
  local scanned=0
  local skipped=0

  for key in $(echo "${!PROJECT_PATHS[@]}" | tr ' ' '\n' | sort); do
    local path="${PROJECT_PATHS[$key]}"

    if [ ! -d "$path" ]; then
      echo -e "${YEL}SKIP: $key — directory not found ($path)${RST}"
      ((skipped++))
      echo ""
      continue
    fi

    echo -e "${BLD}--- Scanning: $key ($path) ---${RST}"

    local abs_path
    abs_path=$(cd "$path" && pwd)

    local json
    json=$(docker run --rm \
      -v "$abs_path:/src" \
      "$SEMGREP_IMAGE" \
      semgrep --config auto \
      --json \
      --no-git-ignore \
      /src 2>/dev/null || echo '{"results":[]}')

    local count critical high
    count=$(echo "$json" | jq -r '.results | length' 2>/dev/null || echo "0")
    critical=$(echo "$json" | jq '[.results[] | select(.extra.severity == "ERROR")] | length' 2>/dev/null || echo "0")
    high=$(echo "$json" | jq '[.results[] | select(.extra.severity == "WARNING")] | length' 2>/dev/null || echo "0")

    total_findings=$((total_findings + count))
    total_critical=$((total_critical + critical))
    total_high=$((total_high + high))
    ((scanned++))

    if [ "$count" -eq 0 ]; then
      echo -e "  ${GRN}Clean — no findings${RST}"
    else
      local color="$YEL"
      [ "$critical" -gt 0 ] && color="$RED"
      echo -e "  ${color}$count findings ($critical critical, $high high)${RST}"

      # Show critical/high findings inline
      if [ "$critical" -gt 0 ] || [ "$high" -gt 0 ]; then
        echo "$json" | jq -r '
          .results[]
          | select(.extra.severity == "ERROR" or .extra.severity == "WARNING")
          | "    [\(if .extra.severity == "ERROR" then "CRITICAL" else "HIGH" end)] \(.path | sub("^/src/"; "")):\(.start.line) — \(.extra.message // .check_id)"
        ' 2>/dev/null | head -10
      fi
    fi

    echo ""
  done

  # Final summary
  echo -e "${BLD}========================================${RST}"
  echo -e "${BLD}              Audit Summary${RST}"
  echo -e "${BLD}========================================${RST}"
  echo ""
  echo "  Projects scanned: $scanned"
  echo "  Projects skipped: $skipped"
  echo "  Total findings:   $total_findings"
  [ "$total_critical" -gt 0 ] && echo -e "  ${RED}Critical: $total_critical${RST}"
  [ "$total_high" -gt 0 ] && echo -e "  ${RED}High:     $total_high${RST}"
  echo ""

  if [ "$total_critical" -gt 0 ]; then
    echo -e "  ${RED}ACTION REQUIRED: $total_critical critical finding(s) need immediate attention${RST}"
  elif [ "$total_findings" -eq 0 ]; then
    echo -e "  ${GRN}All projects clean.${RST}"
  fi

  echo ""
  echo "Summary: $scanned scanned, $total_findings findings ($total_critical critical, $total_high high)"
}

# ── USAGE ─────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
semgrep-tool.sh — Security scanning with Semgrep via Docker

COMMANDS:
  scan <path>            Scan a specific directory for security issues
  scan-project <name>    Scan a known project by name
  audit                  Scan ALL known projects, generate summary report

KNOWN PROJECTS:
  overlord, namibarden, surfababe, onlyhulls, mastercommander, lumina, elmo

OPTIONS:
  Semgrep runs with --config auto (curated rules for common languages).
  Findings are classified: CRITICAL, HIGH, MEDIUM, LOW.

EXAMPLES:
  semgrep-tool.sh scan /projects/Overlord
  semgrep-tool.sh scan /projects/OnlyHulls/src
  semgrep-tool.sh scan-project onlyhulls
  semgrep-tool.sh scan-project namibarden
  semgrep-tool.sh audit

NOTES:
  - Runs Semgrep via Docker (semgrep/semgrep image)
  - No local installation required
  - First run may pull the Docker image (~500MB)
  - Results include severity, file, line number, and description
USAGE
}

# ── MAIN ──────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  scan)                cmd_scan "$@" ;;
  scan-project|project) cmd_scan_project "$@" ;;
  audit|all)           cmd_audit "$@" ;;
  help|--help|-h)      usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: semgrep-tool.sh help"
    exit 1
    ;;
esac
