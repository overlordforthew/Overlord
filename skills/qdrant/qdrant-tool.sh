#!/bin/bash
# qdrant-tool.sh — CLI tool for Qdrant vector database operations
# Talks to the Qdrant REST API over the coolify Docker network.
# Container: qdrant, Port: 6333
set -euo pipefail

QDRANT_HOST="${QDRANT_HOST:-qdrant}"
QDRANT_PORT="${QDRANT_PORT:-6333}"
BASE_URL="http://${QDRANT_HOST}:${QDRANT_PORT}"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

usage() {
    cat <<'EOF'
Usage: qdrant-tool.sh <command> [options]

Commands:
  info                              Show Qdrant server info
  list-collections                  List all collections
  create-collection <name> [size]   Create collection (default vector size: 1536)
  delete-collection <name>          Delete a collection
  upsert <collection> <id> <vector_json> [payload_json]
                                    Upsert a single point
  search <collection> <vector_json> [--limit N]
                                    Search by vector similarity

Options:
  --limit N    Number of results for search (default: 5)

Environment:
  QDRANT_HOST  Override hostname (default: qdrant)
  QDRANT_PORT  Override port     (default: 6333)

Examples:
  qdrant-tool.sh info
  qdrant-tool.sh create-collection memories 1536
  qdrant-tool.sh list-collections
  qdrant-tool.sh upsert memories 1 '[0.1,0.2,0.3]' '{"text":"hello"}'
  qdrant-tool.sh search memories '[0.1,0.2,0.3]' --limit 3
  qdrant-tool.sh delete-collection memories
EOF
    exit 1
}

die() { echo "ERROR: $*" >&2; exit 1; }

# Wrapper around curl that standardises flags and error handling.
api() {
    local method="$1" path="$2"
    shift 2
    local response
    response=$(curl -sf --max-time 10 -X "$method" \
        -H "Content-Type: application/json" \
        "${BASE_URL}${path}" "$@" 2>&1) \
        || die "Request failed: ${method} ${path} — ${response}"
    echo "$response"
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_info() {
    echo "=== Qdrant Server Info ==="
    api GET "/" | python3 -m json.tool 2>/dev/null || api GET "/"
}

cmd_list_collections() {
    echo "=== Collections ==="
    local raw
    raw=$(api GET "/collections")
    # Pretty-print collection names, one per line
    echo "$raw" | python3 -c "
import sys, json
data = json.load(sys.stdin)
cols = data.get('result', {}).get('collections', [])
if not cols:
    print('(none)')
else:
    for c in cols:
        print(c['name'])
" 2>/dev/null || echo "$raw"
}

cmd_create_collection() {
    local name="${1:?Collection name required}"
    local size="${2:-1536}"

    echo "Creating collection '${name}' (vector size: ${size}, distance: Cosine)..."
    api PUT "/collections/${name}" \
        -d "{\"vectors\":{\"size\":${size},\"distance\":\"Cosine\"}}"
    echo "Collection '${name}' created."
}

cmd_delete_collection() {
    local name="${1:?Collection name required}"

    echo "Deleting collection '${name}'..."
    api DELETE "/collections/${name}"
    echo "Collection '${name}' deleted."
}

cmd_upsert() {
    local collection="${1:?Collection name required}"
    local id="${2:?Point ID required}"
    local vector="${3:?Vector JSON array required}"
    local payload="${4:-\{\}}"

    # Build the upsert payload
    local body
    body=$(printf '{"points":[{"id":%s,"vector":%s,"payload":%s}]}' \
        "$id" "$vector" "$payload")

    echo "Upserting point ${id} into '${collection}'..."
    api PUT "/collections/${collection}/points" -d "$body"
    echo "Point ${id} upserted."
}

cmd_search() {
    local collection="${1:?Collection name required}"
    local vector="${2:?Vector JSON array required}"
    shift 2

    local limit=5

    # Parse optional flags
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --limit) limit="${2:?--limit requires a value}"; shift 2 ;;
            *) die "Unknown search option: $1" ;;
        esac
    done

    local body
    body=$(printf '{"vector":%s,"limit":%d,"with_payload":true}' "$vector" "$limit")

    echo "=== Search in '${collection}' (limit ${limit}) ==="
    local raw
    raw=$(api POST "/collections/${collection}/points/search" -d "$body")

    # Pretty-print results: id, score, payload
    echo "$raw" | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('result', [])
if not results:
    print('No results.')
else:
    for i, r in enumerate(results, 1):
        print(f'[{i}] id={r[\"id\"]}  score={r[\"score\"]:.4f}')
        payload = r.get('payload', {})
        if payload:
            for k, v in payload.items():
                print(f'    {k}: {v}')
        print()
" 2>/dev/null || echo "$raw"
}

# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

COMMAND="${1:-}"
shift || true

case "$COMMAND" in
    info)               cmd_info ;;
    list-collections)   cmd_list_collections ;;
    create-collection)  cmd_create_collection "$@" ;;
    delete-collection)  cmd_delete_collection "$@" ;;
    upsert)             cmd_upsert "$@" ;;
    search)             cmd_search "$@" ;;
    -h|--help|"")       usage ;;
    *)                  die "Unknown command: $COMMAND (run with --help)" ;;
esac
