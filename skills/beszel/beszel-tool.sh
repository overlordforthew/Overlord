#!/bin/bash
# beszel-tool.sh — Query Beszel monitoring API (PocketBase backend)
# Container: beszel, port 8090, on coolify network
set -euo pipefail

BESZEL_HOST="${BESZEL_HOST:-beszel}"
BESZEL_PORT="${BESZEL_PORT:-8090}"
BASE_URL="http://${BESZEL_HOST}:${BESZEL_PORT}"
COMMAND="${1:-help}"

# Helper: HTTP GET with timeout, returns body. Exits on failure.
api_get() {
    local path="$1"
    local response
    response=$(curl -sf --max-time 10 "${BASE_URL}${path}" 2>/dev/null) || {
        echo "ERROR: Failed to reach Beszel at ${BASE_URL}${path}"
        return 1
    }
    echo "$response"
}

# Helper: Parse JSON with python3 (always available; jq may not be)
json_parse() {
    python3 -c "
import sys, json
data = json.load(sys.stdin)
$1
"
}

# --- Commands ---

cmd_health() {
    # Quick health probe — try /api/health first, fall back to root
    local code
    code=$(curl -so /dev/null -w '%{http_code}' --max-time 5 "${BASE_URL}/api/health" 2>/dev/null || echo "000")
    if [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then
        echo "Beszel: UP (HTTP ${code})"
        return 0
    fi
    # Fall back to base URL
    code=$(curl -so /dev/null -w '%{http_code}' --max-time 5 "${BASE_URL}/" 2>/dev/null || echo "000")
    if [ "$code" -ge 200 ] && [ "$code" -lt 400 ]; then
        echo "Beszel: UP (HTTP ${code})"
    else
        echo "Beszel: DOWN (HTTP ${code})"
        return 1
    fi
}

cmd_status() {
    echo "=== Beszel System Status ==="
    echo "Endpoint: ${BASE_URL}"
    echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    echo ""

    # Health check first
    cmd_health
    echo ""

    # Try PocketBase collections list to discover available data
    local collections
    collections=$(api_get "/api/collections" 2>/dev/null) || true

    if [ -n "$collections" ]; then
        echo "--- Available Collections ---"
        echo "$collections" | json_parse "
items = data if isinstance(data, list) else data.get('items', data.get('collections', []))
if isinstance(items, list):
    for c in items:
        name = c.get('name', c.get('id', 'unknown'))
        print(f'  {name}')
else:
    print('  (Could not parse collections)')
"
    else
        echo "Note: Collections endpoint not accessible (may need auth)"
    fi

    echo ""

    # Try system info endpoints
    for endpoint in "/api/v1/system" "/_/api/settings" "/api/settings"; do
        local resp
        resp=$(api_get "$endpoint" 2>/dev/null) || continue
        echo "--- System Info (${endpoint}) ---"
        echo "$resp" | json_parse "
for k, v in (data if isinstance(data, dict) else {}).items():
    if isinstance(v, (str, int, float, bool)):
        print(f'  {k}: {v}')
" 2>/dev/null || echo "  (raw) $resp"
        echo ""
        break
    done
}

cmd_containers() {
    echo "=== Beszel Container Stats ==="

    # Try multiple known endpoints for container data
    local resp=""
    for endpoint in "/api/v1/containers" "/api/collections/systems/records" "/api/collections/containers/records"; do
        resp=$(api_get "$endpoint" 2>/dev/null) || continue
        if [ -n "$resp" ]; then
            echo "Source: ${endpoint}"
            echo ""
            echo "$resp" | json_parse "
items = data if isinstance(data, list) else data.get('items', data.get('records', []))
if isinstance(items, list) and len(items) > 0:
    for item in items:
        name = item.get('name', item.get('hostname', item.get('id', '?')))
        status = item.get('status', item.get('state', ''))
        cpu = item.get('cpu', item.get('cpu_percent', ''))
        mem = item.get('memory', item.get('mem_percent', ''))
        line = f'  {name}'
        if status: line += f'  status={status}'
        if cpu: line += f'  cpu={cpu}'
        if mem: line += f'  mem={mem}'
        print(line)
elif isinstance(data, dict):
    for k, v in data.items():
        print(f'  {k}: {v}')
else:
    print('  No container data found')
"
            return 0
        fi
    done

    echo "Could not retrieve container stats."
    echo "Beszel may require authentication. Try:"
    echo "  1. Log into Beszel at ${BASE_URL}"
    echo "  2. Create an API token"
    echo "  3. Set BESZEL_TOKEN environment variable"
}

cmd_alerts() {
    echo "=== Beszel Alerts ==="

    local resp=""
    for endpoint in "/api/v1/alerts" "/api/collections/alerts/records" "/api/collections/notifications/records"; do
        resp=$(api_get "$endpoint" 2>/dev/null) || continue
        if [ -n "$resp" ]; then
            echo "Source: ${endpoint}"
            echo ""
            echo "$resp" | json_parse "
items = data if isinstance(data, list) else data.get('items', data.get('records', []))
if isinstance(items, list):
    if len(items) == 0:
        print('  No active alerts')
    else:
        for a in items:
            name = a.get('name', a.get('title', a.get('id', '?')))
            level = a.get('level', a.get('severity', a.get('type', '')))
            msg = a.get('message', a.get('description', a.get('body', '')))
            created = a.get('created', a.get('timestamp', ''))
            line = f'  [{level}] {name}'
            if msg: line += f': {msg}'
            if created: line += f' ({created})'
            print(line)
elif isinstance(data, dict):
    for k, v in data.items():
        print(f'  {k}: {v}')
else:
    print('  No alert data found')
"
            return 0
        fi
    done

    echo "Could not retrieve alerts."
    echo "This endpoint may require authentication."
}

cmd_help() {
    cat <<'USAGE'
Usage: beszel-tool.sh <command>

Commands:
  status      Overall system status and available data
  containers  List container stats from Beszel
  alerts      Show active alerts/notifications
  health      Quick health check (one-liner)
  help        Show this help

Environment:
  BESZEL_HOST  Hostname (default: beszel)
  BESZEL_PORT  Port (default: 8090)

Examples:
  beszel-tool.sh health
  beszel-tool.sh status
  beszel-tool.sh containers
  beszel-tool.sh alerts
USAGE
}

# --- Dispatch ---
case "$COMMAND" in
    status)     cmd_status ;;
    containers) cmd_containers ;;
    alerts)     cmd_alerts ;;
    health)     cmd_health ;;
    help|--help|-h) cmd_help ;;
    *)
        echo "Unknown command: $COMMAND"
        echo ""
        cmd_help
        exit 1
        ;;
esac
