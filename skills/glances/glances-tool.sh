#!/bin/bash
# glances-tool.sh — Query Glances REST API v4 for system metrics
# Container: glances, port 61208, on coolify network
set -euo pipefail

GLANCES_HOST="${GLANCES_HOST:-glances}"
GLANCES_PORT="${GLANCES_PORT:-61208}"
BASE_URL="http://${GLANCES_HOST}:${GLANCES_PORT}/api/4"
COMMAND="${1:-help}"

# Helper: HTTP GET with timeout
api_get() {
    local path="$1"
    local response
    response=$(curl -sf --max-time 10 "${BASE_URL}${path}" 2>/dev/null) || {
        echo "ERROR: Failed to reach Glances at ${BASE_URL}${path}"
        return 1
    }
    echo "$response"
}

# Helper: Parse JSON with python3
json_parse() {
    python3 -c "
import sys, json
data = json.load(sys.stdin)
$1
"
}

# --- Commands ---

cmd_cpu() {
    echo "=== CPU Usage ==="
    api_get "/cpu" | json_parse "
total = data.get('total', 0)
user = data.get('user', 0)
system = data.get('system', 0)
iowait = data.get('iowait', 0)
idle = data.get('idle', 0)
steal = data.get('steal', 0)
nice = data.get('nice', 0)
cpucore = data.get('cpucore', '?')
print(f'Total:   {total:.1f}%')
print(f'User:    {user:.1f}%')
print(f'System:  {system:.1f}%')
print(f'I/O Wait:{iowait:.1f}%')
print(f'Idle:    {idle:.1f}%')
print(f'Steal:   {steal:.1f}%')
print(f'Nice:    {nice:.1f}%')
print(f'Cores:   {cpucore}')
"

    echo ""
    echo "--- Per-Core ---"
    api_get "/percpu" | json_parse "
if isinstance(data, list):
    for i, core in enumerate(data):
        total = core.get('total', 0)
        print(f'  Core {i}: {total:.1f}%')
else:
    print('  Per-core data not available')
" 2>/dev/null || echo "  Per-core data not available"

    echo ""
    echo "--- Load Average ---"
    api_get "/load" | json_parse "
min1 = data.get('min1', 0)
min5 = data.get('min5', 0)
min15 = data.get('min15', 0)
cpucore = data.get('cpucore', '?')
print(f'  1min: {min1:.2f}  5min: {min5:.2f}  15min: {min15:.2f}  (cores: {cpucore})')
" 2>/dev/null || echo "  Load data not available"
}

cmd_mem() {
    echo "=== Memory Usage ==="
    api_get "/mem" | json_parse "
total = data.get('total', 0)
used = data.get('used', 0)
free = data.get('free', 0)
available = data.get('available', 0)
percent = data.get('percent', 0)
buffers = data.get('buffers', 0)
cached = data.get('cached', 0)

def fmt(b):
    if b >= 1073741824:
        return f'{b/1073741824:.1f} GB'
    elif b >= 1048576:
        return f'{b/1048576:.1f} MB'
    else:
        return f'{b/1024:.1f} KB'

print(f'Used:      {fmt(used)} / {fmt(total)} ({percent:.1f}%)')
print(f'Free:      {fmt(free)}')
print(f'Available: {fmt(available)}')
print(f'Buffers:   {fmt(buffers)}')
print(f'Cached:    {fmt(cached)}')
"

    echo ""
    echo "--- Swap ---"
    api_get "/memswap" | json_parse "
total = data.get('total', 0)
used = data.get('used', 0)
percent = data.get('percent', 0)

def fmt(b):
    if b >= 1073741824:
        return f'{b/1073741824:.1f} GB'
    elif b >= 1048576:
        return f'{b/1048576:.1f} MB'
    else:
        return f'{b/1024:.1f} KB'

if total > 0:
    print(f'  Swap: {fmt(used)} / {fmt(total)} ({percent:.1f}%)')
else:
    print('  No swap configured')
" 2>/dev/null || echo "  Swap data not available"
}

cmd_disk() {
    echo "=== Disk Usage ==="
    api_get "/fs" | json_parse "
def fmt(b):
    if b >= 1073741824:
        return f'{b/1073741824:.1f} GB'
    elif b >= 1048576:
        return f'{b/1048576:.1f} MB'
    else:
        return f'{b/1024:.1f} KB'

if isinstance(data, list):
    for fs in data:
        mnt = fs.get('mnt_point', '?')
        device = fs.get('device_name', '?')
        used = fs.get('used', 0)
        total = fs.get('size', 0)
        percent = fs.get('percent', 0)
        fstype = fs.get('fs_type', '')
        print(f'{mnt} ({device}, {fstype})')
        print(f'  {fmt(used)} / {fmt(total)} ({percent:.1f}%)')
else:
    print('No filesystem data available')
"

    echo ""
    echo "--- Disk I/O ---"
    api_get "/diskio" | json_parse "
def fmt_rate(b):
    if b >= 1048576:
        return f'{b/1048576:.1f} MB/s'
    elif b >= 1024:
        return f'{b/1024:.1f} KB/s'
    else:
        return f'{b:.0f} B/s'

if isinstance(data, list):
    for disk in data:
        name = disk.get('disk_name', '?')
        read_bytes = disk.get('read_bytes_rate_per_sec', disk.get('read_bytes', 0))
        write_bytes = disk.get('write_bytes_rate_per_sec', disk.get('write_bytes', 0))
        print(f'  {name}: read={fmt_rate(read_bytes)} write={fmt_rate(write_bytes)}')
else:
    print('  No disk I/O data available')
" 2>/dev/null || echo "  Disk I/O data not available"
}

cmd_network() {
    echo "=== Network I/O ==="
    api_get "/network" | json_parse "
def fmt_rate(b):
    if b >= 1048576:
        return f'{b/1048576:.1f} MB/s'
    elif b >= 1024:
        return f'{b/1024:.1f} KB/s'
    else:
        return f'{b:.0f} B/s'

def fmt_bytes(b):
    if b >= 1073741824:
        return f'{b/1073741824:.1f} GB'
    elif b >= 1048576:
        return f'{b/1048576:.1f} MB'
    else:
        return f'{b/1024:.1f} KB'

if isinstance(data, list):
    for iface in data:
        name = iface.get('interface_name', '?')
        is_up = iface.get('is_up', True)
        if not is_up:
            continue
        rx_rate = iface.get('rx', iface.get('bytes_recv_rate_per_sec', 0))
        tx_rate = iface.get('tx', iface.get('bytes_sent_rate_per_sec', 0))
        rx_total = iface.get('bytes_recv', iface.get('cumulative_rx', 0))
        tx_total = iface.get('bytes_sent', iface.get('cumulative_tx', 0))
        print(f'{name}:')
        print(f'  RX: {fmt_rate(rx_rate)} (total: {fmt_bytes(rx_total)})')
        print(f'  TX: {fmt_rate(tx_rate)} (total: {fmt_bytes(tx_total)})')
else:
    print('No network data available')
"
}

cmd_docker() {
    echo "=== Docker Containers (via Glances) ==="
    api_get "/containers" | json_parse "
def fmt(b):
    if b >= 1073741824:
        return f'{b/1073741824:.1f} GB'
    elif b >= 1048576:
        return f'{b/1048576:.1f} MB'
    elif b >= 1024:
        return f'{b/1024:.1f} KB'
    else:
        return f'{b:.0f} B'

if isinstance(data, list):
    if len(data) == 0:
        print('No containers found')
    else:
        running = [c for c in data if c.get('Status','') == 'running' or c.get('status','') == 'running']
        other = [c for c in data if c not in running]
        print(f'Running: {len(running)}  Other: {len(other)}')
        print()
        for c in sorted(data, key=lambda x: x.get('name', x.get('Names', ['?'])[0] if isinstance(x.get('Names'), list) else '?')):
            name_raw = c.get('name', c.get('Names', ['?']))
            name = name_raw[0].lstrip('/') if isinstance(name_raw, list) else str(name_raw).lstrip('/')
            status = c.get('Status', c.get('status', '?'))
            cpu = c.get('cpu_percent', c.get('cpu', {}).get('total', ''))
            mem_usage = c.get('memory_usage', c.get('memory', {}).get('usage', 0))
            mem_limit = c.get('memory_limit', c.get('memory', {}).get('limit', 0))
            line = f'  {name:<30} {status:<12}'
            if cpu != '':
                line += f' CPU: {cpu:>5.1f}%'
            if mem_usage:
                line += f'  MEM: {fmt(mem_usage)}'
                if mem_limit:
                    line += f' / {fmt(mem_limit)}'
            print(line)
else:
    print('No container data available')
"
}

cmd_all() {
    echo "=============================="
    echo "  Glances Full System Snapshot"
    echo "  $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
    echo "=============================="
    echo ""
    cmd_cpu
    echo ""
    cmd_mem
    echo ""
    cmd_disk
    echo ""
    cmd_network
    echo ""
    cmd_docker
}

cmd_quick() {
    # One-liner: CPU%, MEM%, DISK%
    local cpu_pct mem_pct disk_pct

    cpu_pct=$(api_get "/cpu" 2>/dev/null | json_parse "print(f\"{data.get('total', 0):.1f}\")" 2>/dev/null || echo "?")
    mem_pct=$(api_get "/mem" 2>/dev/null | json_parse "print(f\"{data.get('percent', 0):.1f}\")" 2>/dev/null || echo "?")
    disk_pct=$(api_get "/fs" 2>/dev/null | json_parse "
if isinstance(data, list):
    root = [f for f in data if f.get('mnt_point') == '/']
    if root:
        print(f\"{root[0].get('percent', 0):.1f}\")
    elif data:
        print(f\"{data[0].get('percent', 0):.1f}\")
    else:
        print('?')
else:
    print('?')
" 2>/dev/null || echo "?")

    echo "CPU: ${cpu_pct}% | MEM: ${mem_pct}% | DISK: ${disk_pct}%"
}

cmd_help() {
    cat <<'USAGE'
Usage: glances-tool.sh <command>

Commands:
  cpu       CPU usage details (total, per-core, load)
  mem       Memory and swap usage
  disk      Disk usage and I/O rates
  network   Network interface I/O
  docker    Docker container stats
  all       Full system snapshot (all of the above)
  quick     One-liner: CPU%, MEM%, DISK%
  help      Show this help

Environment:
  GLANCES_HOST  Hostname (default: glances)
  GLANCES_PORT  Port (default: 61208)

Examples:
  glances-tool.sh quick
  glances-tool.sh cpu
  glances-tool.sh all
  glances-tool.sh docker
USAGE
}

# --- Dispatch ---
case "$COMMAND" in
    cpu)     cmd_cpu ;;
    mem)     cmd_mem ;;
    disk)    cmd_disk ;;
    network) cmd_network ;;
    docker)  cmd_docker ;;
    all)     cmd_all ;;
    quick)   cmd_quick ;;
    help|--help|-h) cmd_help ;;
    *)
        echo "Unknown command: $COMMAND"
        echo ""
        cmd_help
        exit 1
        ;;
esac
