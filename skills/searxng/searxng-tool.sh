#!/bin/bash
# searxng-tool.sh — CLI tool for SearXNG meta-search engine
# Talks to the SearXNG JSON API over the coolify Docker network.
# Container: searxng, internal port: 8080
set -euo pipefail

SEARXNG_HOST="${SEARXNG_HOST:-searxng}"
SEARXNG_PORT="${SEARXNG_PORT:-8080}"
BASE_URL="http://${SEARXNG_HOST}:${SEARXNG_PORT}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

usage() {
    cat <<'EOF'
Usage: searxng-tool.sh <command> [options]

Commands:
  search <query>       Search the web via SearXNG
  engines              List available search engines
  stats                Show SearXNG instance statistics

Search options:
  --engines <list>     Comma-separated engine names (e.g. google,duckduckgo)
  --limit N            Max results to display (default: 5)
  --categories <list>  Comma-separated categories (general,images,news,...)

Environment:
  SEARXNG_HOST  Override hostname (default: searxng)
  SEARXNG_PORT  Override port     (default: 8080)

Examples:
  searxng-tool.sh search "rust async best practices"
  searxng-tool.sh search "hetzner pricing" --engines google,duckduckgo --limit 3
  searxng-tool.sh search "surfboard fins" --categories general
  searxng-tool.sh engines
  searxng-tool.sh stats
EOF
    exit 1
}

die() { echo "ERROR: $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_search() {
    [[ $# -lt 1 ]] && die "search requires a query"

    local query="$1"
    shift

    local limit=5
    local engines=""
    local categories=""

    # Parse optional flags
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --engines)    engines="${2:?--engines requires a value}"; shift 2 ;;
            --limit)      limit="${2:?--limit requires a value}"; shift 2 ;;
            --categories) categories="${2:?--categories requires a value}"; shift 2 ;;
            *)            die "Unknown option: $1" ;;
        esac
    done

    # Build query string
    local params="q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$query'))")&format=json"
    [[ -n "$engines" ]]    && params="${params}&engines=${engines}"
    [[ -n "$categories" ]] && params="${params}&categories=${categories}"

    local raw
    raw=$(curl -sf --max-time 15 -H "X-Real-IP: 127.0.0.1" "${BASE_URL}/search?${params}" 2>&1) \
        || die "Search request failed — ${raw}"

    # Format results as clean readable text
    echo "$raw" | python3 -c "
import sys, json

data = json.load(sys.stdin)
results = data.get('results', [])
limit = ${limit}

if not results:
    print('No results found.')
    sys.exit(0)

shown = min(limit, len(results))
print(f'=== Search Results ({shown} of {len(results)}) ===')
print()

for i, r in enumerate(results[:limit], 1):
    title = r.get('title', '(no title)')
    url = r.get('url', '')
    snippet = r.get('content', r.get('description', ''))

    print(f'[{i}] {title}')
    print(f'    {url}')
    if snippet:
        # Collapse whitespace and trim long snippets
        snippet = ' '.join(snippet.split())
        if len(snippet) > 200:
            snippet = snippet[:197] + '...'
        print(f'    {snippet}')
    print()
" 2>/dev/null || echo "$raw"
}

cmd_engines() {
    echo "=== Available Engines ==="
    local raw
    raw=$(curl -sf --max-time 10 -H "X-Real-IP: 127.0.0.1" "${BASE_URL}/config" 2>&1) \
        || die "Config request failed — ${raw}"

    echo "$raw" | python3 -c "
import sys, json

data = json.load(sys.stdin)
engines = data.get('engines', [])

if not engines:
    print('No engines found.')
    sys.exit(0)

# Group by category
by_cat = {}
for e in engines:
    for cat in e.get('categories', ['uncategorized']):
        by_cat.setdefault(cat, []).append(e['name'])

for cat in sorted(by_cat):
    names = sorted(set(by_cat[cat]))
    print(f'\n[{cat}]')
    for n in names:
        print(f'  {n}')
" 2>/dev/null || echo "$raw"
}

cmd_stats() {
    echo "=== SearXNG Stats ==="

    # Basic health check
    local code
    code=$(curl -so /dev/null -w '%{http_code}' --max-time 5 -H "X-Real-IP: 127.0.0.1" "${BASE_URL}/" 2>/dev/null || echo "000")
    if [[ "$code" -ge 200 && "$code" -lt 400 ]]; then
        echo "Status: UP (HTTP ${code})"
    else
        echo "Status: DOWN (HTTP ${code})"
        return 1
    fi
    echo "Endpoint: ${BASE_URL}"

    # Fetch config for engine count
    local raw
    raw=$(curl -sf --max-time 10 -H "X-Real-IP: 127.0.0.1" "${BASE_URL}/config" 2>&1) || {
        echo "Could not fetch config."
        return 0
    }

    echo "$raw" | python3 -c "
import sys, json

data = json.load(sys.stdin)
engines = data.get('engines', [])
cats = set()
for e in engines:
    for c in e.get('categories', []):
        cats.add(c)

print(f'Engines: {len(engines)}')
print(f'Categories: {len(cats)} ({', '.join(sorted(cats))})')
version = data.get('version', 'unknown')
print(f'Version: {version}')
" 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
    search)   cmd_search "$@" ;;
    engines)  cmd_engines ;;
    stats)    cmd_stats ;;
    -h|--help|"") usage ;;
    *)        die "Unknown command: $COMMAND (run with --help)" ;;
esac
