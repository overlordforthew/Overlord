#!/bin/bash
# performance-profiler — System performance profiling for Hetzner CX33
# 4-core AMD EPYC, 8GB RAM, 80GB SSD, Ubuntu 24.04
# Usage: perf-profile.sh <command>
set -euo pipefail

HISTORY_FILE="/root/overlord/data/perf-history.jsonl"

# ── HELPERS ──────────────────────────────────────────────────────────────────

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# Get CPU usage percentage from /proc/stat (two samples, 1s apart)
get_cpu_pct() {
  local c1 c2
  c1=$(awk '/^cpu / {print $2+$3+$4+$5+$6+$7+$8, $5}' /proc/stat)
  sleep 1
  c2=$(awk '/^cpu / {print $2+$3+$4+$5+$6+$7+$8, $5}' /proc/stat)
  local total1 idle1 total2 idle2
  total1=$(echo "$c1" | awk '{print $1}')
  idle1=$(echo "$c1" | awk '{print $2}')
  total2=$(echo "$c2" | awk '{print $1}')
  idle2=$(echo "$c2" | awk '{print $2}')
  local dtotal didle
  dtotal=$((total2 - total1))
  didle=$((idle2 - idle1))
  if [ "$dtotal" -eq 0 ]; then
    echo "0"
  else
    echo $(( (dtotal - didle) * 100 / dtotal ))
  fi
}

# Get memory percentage used
get_mem_pct() {
  awk '/MemTotal/ {t=$2} /MemAvailable/ {a=$2} END {printf "%d", (t-a)*100/t}' /proc/meminfo
}

# Get root disk percentage used
get_disk_pct() {
  df / | awk 'NR==2 {gsub(/%/,""); print $5}'
}

# Get 1-minute load average
get_load_1m() {
  awk '{print $1}' /proc/loadavg
}

# Format bytes to human-readable
human_bytes() {
  local bytes=$1
  if [ "$bytes" -ge 1073741824 ]; then
    echo "$(( bytes / 1073741824 )) GB"
  elif [ "$bytes" -ge 1048576 ]; then
    echo "$(( bytes / 1048576 )) MB"
  elif [ "$bytes" -ge 1024 ]; then
    echo "$(( bytes / 1024 )) KB"
  else
    echo "${bytes} B"
  fi
}

# Append snapshot data to history file
append_history() {
  local cpu_pct="$1" mem_pct="$2" disk_pct="$3" load_1m="$4"
  mkdir -p "$(dirname "$HISTORY_FILE")"
  printf '{"ts":"%s","cpu_pct":%s,"mem_pct":%s,"disk_pct":%s,"load_1m":%s}\n' \
    "$(now_iso)" "$cpu_pct" "$mem_pct" "$disk_pct" "$load_1m" >> "$HISTORY_FILE"
}

# ── COMMANDS ─────────────────────────────────────────────────────────────────

cmd_snapshot() {
  echo "=== System Snapshot — $(date) ==="
  echo ""

  # CPU
  local cpu_pct
  cpu_pct=$(get_cpu_pct)
  echo "CPU Usage:     ${cpu_pct}%"

  # Load
  local load
  load=$(cat /proc/loadavg | awk '{print $1, $2, $3}')
  echo "Load Average:  $load (1m / 5m / 15m)"

  # Memory
  local mem_total mem_used mem_avail mem_pct
  mem_total=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  mem_avail=$(awk '/MemAvailable/ {print $2}' /proc/meminfo)
  mem_used=$((mem_total - mem_avail))
  mem_pct=$(( mem_used * 100 / mem_total ))
  echo "Memory:        $(( mem_used / 1024 )) MiB / $(( mem_total / 1024 )) MiB (${mem_pct}%)"

  # Swap
  local swap_total swap_free swap_used
  swap_total=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)
  swap_free=$(awk '/SwapFree/ {print $2}' /proc/meminfo)
  swap_used=$((swap_total - swap_free))
  if [ "$swap_total" -gt 0 ]; then
    echo "Swap:          $(( swap_used / 1024 )) MiB / $(( swap_total / 1024 )) MiB"
  else
    echo "Swap:          none"
  fi

  # Disk
  local disk_pct disk_used disk_total
  read -r disk_used disk_total disk_pct <<< "$(df / | awk 'NR==2 {gsub(/%/,""); print $3, $2, $5}')"
  echo "Disk (/):      $(( disk_used / 1024 / 1024 )) GiB / $(( disk_total / 1024 / 1024 )) GiB (${disk_pct}%)"

  # Uptime
  echo "Uptime:        $(uptime -p)"

  echo ""
  echo "── Top 5 by CPU ──"
  ps aux --sort=-%cpu | awk 'NR<=6 {printf "  %-8s %5s%% %5s%%  %s\n", $1, $3, $4, $11}'

  echo ""
  echo "── Top 5 by Memory ──"
  ps aux --sort=-%mem | awk 'NR<=6 {printf "  %-8s %5s%% %5s%%  %s\n", $1, $3, $4, $11}'

  # Append to history
  local load_1m
  load_1m=$(awk '{print $1}' /proc/loadavg)
  append_history "$cpu_pct" "$mem_pct" "$disk_pct" "$load_1m"
  echo ""
  echo "(Recorded to $HISTORY_FILE)"
}

cmd_cpu() {
  echo "=== CPU Profile ==="
  echo ""

  # CPU model
  echo "Processor:  $(grep 'model name' /proc/cpuinfo | head -1 | cut -d: -f2 | xargs)"
  echo "Cores:      $(nproc)"
  echo ""

  # Load averages
  echo "Load Averages:"
  local load1 load5 load15
  read -r load1 load5 load15 _ _ < /proc/loadavg
  echo "  1 min:   $load1"
  echo "  5 min:   $load5"
  echo "  15 min:  $load15"
  echo ""

  # Per-core usage (snapshot from /proc/stat)
  echo "Per-Core Usage (1s sample):"
  local stat1 stat2
  stat1=$(grep '^cpu[0-9]' /proc/stat)
  sleep 1
  stat2=$(grep '^cpu[0-9]' /proc/stat)

  paste <(echo "$stat1") <(echo "$stat2") | while read -r line; do
    local name1 u1 n1 s1 i1 w1 q1 sq1 name2 u2 n2 s2 i2 w2 q2 sq2
    read -r name1 u1 n1 s1 i1 w1 q1 sq1 name2 u2 n2 s2 i2 w2 q2 sq2 <<< "$line"
    local total1=$((u1+n1+s1+i1+w1+q1+sq1))
    local total2=$((u2+n2+s2+i2+w2+q2+sq2))
    local dtotal=$((total2 - total1))
    local didle=$((i2 - i1))
    local pct=0
    if [ "$dtotal" -gt 0 ]; then
      pct=$(( (dtotal - didle) * 100 / dtotal ))
    fi
    printf "  %-6s %3d%%\n" "$name1" "$pct"
  done

  echo ""
  echo "── Top 10 CPU Consumers ──"
  printf "  %-8s %6s %6s  %s\n" "USER" "CPU%" "MEM%" "COMMAND"
  ps aux --sort=-%cpu | awk 'NR>1 && NR<=11 {printf "  %-8s %5s%% %5s%%  %s\n", $1, $3, $4, $11}'
}

cmd_memory() {
  echo "=== Memory Profile ==="
  echo ""

  # Detailed breakdown from /proc/meminfo
  local total avail free buffers cached slab swap_total swap_free swap_used
  total=$(awk '/^MemTotal/ {print $2}' /proc/meminfo)
  avail=$(awk '/^MemAvailable/ {print $2}' /proc/meminfo)
  free=$(awk '/^MemFree/ {print $2}' /proc/meminfo)
  buffers=$(awk '/^Buffers/ {print $2}' /proc/meminfo)
  cached=$(awk '/^Cached/ {print $2}' /proc/meminfo)
  slab=$(awk '/^Slab/ {print $2}' /proc/meminfo)
  swap_total=$(awk '/^SwapTotal/ {print $2}' /proc/meminfo)
  swap_free=$(awk '/^SwapFree/ {print $2}' /proc/meminfo)
  swap_used=$((swap_total - swap_free))

  local used=$((total - avail))
  local pct=$(( used * 100 / total ))

  printf "%-14s %10s\n" "Total:" "$(( total / 1024 )) MiB"
  printf "%-14s %10s  (%d%%)\n" "Used:" "$(( used / 1024 )) MiB" "$pct"
  printf "%-14s %10s\n" "Free:" "$(( free / 1024 )) MiB"
  printf "%-14s %10s\n" "Available:" "$(( avail / 1024 )) MiB"
  printf "%-14s %10s\n" "Buffers:" "$(( buffers / 1024 )) MiB"
  printf "%-14s %10s\n" "Cached:" "$(( cached / 1024 )) MiB"
  printf "%-14s %10s\n" "Slab:" "$(( slab / 1024 )) MiB"
  echo ""

  if [ "$swap_total" -gt 0 ]; then
    local swap_pct=$(( swap_used * 100 / swap_total ))
    printf "%-14s %10s\n" "Swap Total:" "$(( swap_total / 1024 )) MiB"
    printf "%-14s %10s  (%d%%)\n" "Swap Used:" "$(( swap_used / 1024 )) MiB" "$swap_pct"
    printf "%-14s %10s\n" "Swap Free:" "$(( swap_free / 1024 )) MiB"
  else
    echo "Swap:          none configured"
  fi

  echo ""
  echo "── Top 10 Memory Consumers ──"
  printf "  %-8s %6s %10s  %s\n" "USER" "MEM%" "RSS" "COMMAND"
  ps aux --sort=-%mem | awk 'NR>1 && NR<=11 {printf "  %-8s %5s%% %7d KB  %s\n", $1, $4, $6, $11}'
}

cmd_disk() {
  echo "=== Disk Profile ==="
  echo ""

  echo "── Filesystem Usage ──"
  df -h --output=target,fstype,size,used,avail,pcent | head -20
  echo ""

  echo "── Inode Usage ──"
  df -i --output=target,itotal,iused,iavail,ipcent | head -20
  echo ""

  echo "── Largest Directories Under /root (top 10) ──"
  du -h --max-depth=2 /root 2>/dev/null | sort -rh | head -10
  echo ""

  echo "── Docker Disk Usage ──"
  docker system df 2>/dev/null || echo "  Docker not accessible"
  echo ""

  echo "── Docker Volumes (top 10 by size) ──"
  docker system df -v 2>/dev/null | awk '/^VOLUME NAME/,0 {print}' | head -12 || echo "  Docker not accessible"
}

cmd_docker() {
  echo "=== Docker Resource Usage ==="
  echo ""

  # Get raw stats, parse and format
  printf "%-25s %6s %14s %6s %20s %20s\n" "CONTAINER" "CPU%" "MEM USAGE" "MEM%" "NET I/O" "BLOCK I/O"
  printf "%-25s %6s %14s %6s %20s %20s\n" "---------" "----" "---------" "----" "-------" "---------"

  docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}' 2>/dev/null | \
    sort | while IFS=$'\t' read -r name cpu mem_usage mem_pct net_io block_io; do
      # Clean up the mem_usage to just show the usage part (before the /)
      local mem_short
      mem_short=$(echo "$mem_usage" | sed 's/ \/ .*//')
      printf "%-25s %6s %14s %6s %20s %20s\n" "$name" "$cpu" "$mem_short" "$mem_pct" "$net_io" "$block_io"
    done

  echo ""

  # Summary
  local running stopped
  running=$(docker ps -q 2>/dev/null | wc -l)
  stopped=$(docker ps -aq --filter "status=exited" 2>/dev/null | wc -l)
  echo "Containers: ${running} running, ${stopped} stopped"
}

cmd_network() {
  echo "=== Network Profile ==="
  echo ""

  echo "── Interface Bandwidth ──"
  printf "  %-12s %15s %15s\n" "INTERFACE" "RX" "TX"
  printf "  %-12s %15s %15s\n" "---------" "--" "--"
  for iface in /sys/class/net/*/; do
    local name
    name=$(basename "$iface")
    [ "$name" = "lo" ] && continue
    local rx_bytes tx_bytes
    rx_bytes=$(cat "${iface}statistics/rx_bytes" 2>/dev/null || echo 0)
    tx_bytes=$(cat "${iface}statistics/tx_bytes" 2>/dev/null || echo 0)
    printf "  %-12s %15s %15s\n" "$name" "$(human_bytes "$rx_bytes")" "$(human_bytes "$tx_bytes")"
  done
  echo ""

  echo "── Connection Counts by State ──"
  ss -s 2>/dev/null
  echo ""

  echo "── TCP Connections by State ──"
  ss -tan 2>/dev/null | awk 'NR>1 {count[$1]++} END {for(s in count) printf "  %-15s %d\n", s, count[s]}' | sort -t' ' -k2 -rn
  echo ""

  echo "── Top 10 Connected IPs ──"
  ss -tn 2>/dev/null | awk 'NR>1 {split($5,a,":"); if(a[1]!="") print a[1]}' | sort | uniq -c | sort -rn | head -10 | \
    awk '{printf "  %-20s %d connections\n", $2, $1}'
}

cmd_history() {
  echo "=== Performance History ==="
  echo ""

  if [ ! -f "$HISTORY_FILE" ]; then
    echo "No history data found. Run 'perf-profile.sh snapshot' to start recording."
    return
  fi

  local count
  count=$(wc -l < "$HISTORY_FILE")
  echo "Total records: $count"
  echo ""

  if [ "$count" -eq 0 ]; then
    echo "History file is empty."
    return
  fi

  # Show last 20 entries
  echo "── Recent Snapshots (last 20) ──"
  printf "  %-22s %6s %6s %6s %8s\n" "TIMESTAMP" "CPU%" "MEM%" "DISK%" "LOAD"
  printf "  %-22s %6s %6s %6s %8s\n" "---------" "----" "----" "-----" "----"
  tail -20 "$HISTORY_FILE" | while read -r line; do
    local ts cpu mem disk load
    ts=$(echo "$line" | sed 's/.*"ts":"\([^"]*\)".*/\1/')
    cpu=$(echo "$line" | sed 's/.*"cpu_pct":\([0-9]*\).*/\1/')
    mem=$(echo "$line" | sed 's/.*"mem_pct":\([0-9]*\).*/\1/')
    disk=$(echo "$line" | sed 's/.*"disk_pct":\([0-9]*\).*/\1/')
    load=$(echo "$line" | sed 's/.*"load_1m":\([0-9.]*\).*/\1/')
    printf "  %-22s %5s%% %5s%% %5s%% %8s\n" "$ts" "$cpu" "$mem" "$disk" "$load"
  done

  echo ""

  # Show averages
  echo "── Averages ──"
  awk -F'[,:}]' '{
    for(i=1;i<=NF;i++) {
      if($i ~ /"cpu_pct"/) {gsub(/[^0-9]/,"",$(i+1)); cpu+=$(i+1); n++}
      if($i ~ /"mem_pct"/) {gsub(/[^0-9]/,"",$(i+1)); mem+=$(i+1)}
      if($i ~ /"disk_pct"/) {gsub(/[^0-9]/,"",$(i+1)); disk+=$(i+1)}
      if($i ~ /"load_1m"/) {gsub(/[^0-9.]/,"",$(i+1)); load+=$(i+1)}
    }
  } END {
    if(n>0) {
      printf "  CPU:  %d%% avg\n", cpu/n
      printf "  MEM:  %d%% avg\n", mem/n
      printf "  DISK: %d%% avg\n", disk/n
      printf "  LOAD: %.2f avg\n", load/n
    }
  }' "$HISTORY_FILE"

  # Show min/max
  echo ""
  echo "── Peaks ──"
  awk -F'[,:}]' '
  BEGIN {max_cpu=0; max_mem=0; max_load=0}
  {
    for(i=1;i<=NF;i++) {
      if($i ~ /"cpu_pct"/) {gsub(/[^0-9]/,"",$(i+1)); v=$(i+1)+0; if(v>max_cpu) max_cpu=v}
      if($i ~ /"mem_pct"/) {gsub(/[^0-9]/,"",$(i+1)); v=$(i+1)+0; if(v>max_mem) max_mem=v}
      if($i ~ /"load_1m"/) {gsub(/[^0-9.]/,"",$(i+1)); v=$(i+1)+0; if(v>max_load) max_load=v}
    }
  } END {
    printf "  Peak CPU:  %d%%\n", max_cpu
    printf "  Peak MEM:  %d%%\n", max_mem
    printf "  Peak LOAD: %.2f\n", max_load
  }' "$HISTORY_FILE"
}

cmd_headroom() {
  echo "=== Capacity Headroom ==="
  echo ""

  # Current usage
  local cpu_pct mem_pct disk_pct
  cpu_pct=$(get_cpu_pct)
  mem_pct=$(get_mem_pct)
  disk_pct=$(get_disk_pct)

  local mem_total_kb mem_avail_kb disk_total_kb disk_avail_kb
  mem_total_kb=$(awk '/^MemTotal/ {print $2}' /proc/meminfo)
  mem_avail_kb=$(awk '/^MemAvailable/ {print $2}' /proc/meminfo)
  read -r disk_total_kb disk_avail_kb <<< "$(df / | awk 'NR==2 {print $2, $4}')"

  local mem_avail_mb=$(( mem_avail_kb / 1024 ))
  local disk_avail_gb=$(( disk_avail_kb / 1024 / 1024 ))
  local running_containers
  running_containers=$(docker ps -q 2>/dev/null | wc -l)

  echo "── Current Usage ──"
  printf "  CPU:         %3d%% used  →  %3d%% free  (4 cores)\n" "$cpu_pct" "$((100 - cpu_pct))"
  printf "  Memory:      %3d%% used  →  %d MiB free  (of %d MiB)\n" "$mem_pct" "$mem_avail_mb" "$((mem_total_kb / 1024))"
  printf "  Disk:        %3d%% used  →  %d GiB free  (of %d GiB)\n" "$disk_pct" "$disk_avail_gb" "$((disk_total_kb / 1024 / 1024))"
  printf "  Containers:  %d running\n" "$running_containers"
  echo ""

  # Estimate new containers
  # Typical container: ~200MB RAM, ~1GB disk
  local container_ram_mb=200
  local container_disk_gb=1

  # Reserve 15% memory and 10% disk as safety buffer
  local safe_mem_mb=$(( mem_avail_mb - (mem_total_kb / 1024 * 15 / 100) ))
  local safe_disk_gb=$(( disk_avail_gb - (disk_total_kb / 1024 / 1024 * 10 / 100) ))

  [ "$safe_mem_mb" -lt 0 ] && safe_mem_mb=0
  [ "$safe_disk_gb" -lt 0 ] && safe_disk_gb=0

  local by_ram=$(( safe_mem_mb / container_ram_mb ))
  local by_disk=$(( safe_disk_gb / container_disk_gb ))

  # The bottleneck is the smaller number
  local estimate=$by_ram
  local bottleneck="RAM"
  if [ "$by_disk" -lt "$by_ram" ]; then
    estimate=$by_disk
    bottleneck="disk"
  fi

  echo "── Capacity Estimate ──"
  echo "  Typical container: ~${container_ram_mb}MB RAM, ~${container_disk_gb}GB disk"
  echo "  Safety buffer:     15% RAM, 10% disk reserved"
  echo ""
  printf "  By RAM:    %d more containers  (%d MiB available after buffer)\n" "$by_ram" "$safe_mem_mb"
  printf "  By Disk:   %d more containers  (%d GiB available after buffer)\n" "$by_disk" "$safe_disk_gb"
  echo ""

  if [ "$estimate" -le 0 ]; then
    echo "  VERDICT: No room for new containers without freeing resources."
  elif [ "$estimate" -le 3 ]; then
    echo "  VERDICT: Tight — room for ~${estimate} more containers (bottleneck: ${bottleneck})"
  elif [ "$estimate" -le 10 ]; then
    echo "  VERDICT: Comfortable — room for ~${estimate} more containers (bottleneck: ${bottleneck})"
  else
    echo "  VERDICT: Plenty of room — ~${estimate} more containers possible (bottleneck: ${bottleneck})"
  fi
}

cmd_alert() {
  local alerts=0

  # CPU check
  local cpu_pct
  cpu_pct=$(get_cpu_pct)
  if [ "$cpu_pct" -gt 80 ]; then
    echo "WARNING: CPU usage at ${cpu_pct}% (threshold: 80%)"
    alerts=$((alerts + 1))
  fi

  # Memory check
  local mem_pct
  mem_pct=$(get_mem_pct)
  if [ "$mem_pct" -gt 85 ]; then
    echo "WARNING: Memory usage at ${mem_pct}% (threshold: 85%)"
    alerts=$((alerts + 1))
  fi

  # Disk check
  local disk_pct
  disk_pct=$(get_disk_pct)
  if [ "$disk_pct" -gt 85 ]; then
    echo "WARNING: Disk usage at ${disk_pct}% (threshold: 85%)"
    alerts=$((alerts + 1))
  fi

  # Container memory check (>1GB = 1073741824 bytes, >1000MiB roughly)
  docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}' 2>/dev/null | while IFS=$'\t' read -r name mem_usage; do
    # Extract the usage value (before the /)
    local usage_str
    usage_str=$(echo "$mem_usage" | sed 's/ \/ .*//' | xargs)
    # Parse the number and unit
    local num unit
    num=$(echo "$usage_str" | grep -oE '[0-9.]+')
    unit=$(echo "$usage_str" | grep -oE '[A-Za-z]+')
    local mem_mb=0
    case "$unit" in
      GiB|GB) mem_mb=$(echo "$num" | awk '{printf "%d", $1 * 1024}') ;;
      MiB|MB) mem_mb=$(echo "$num" | awk '{printf "%d", $1}') ;;
      KiB|KB) mem_mb=0 ;;
      *) mem_mb=0 ;;
    esac
    if [ "$mem_mb" -ge 1024 ]; then
      echo "WARNING: Container '$name' using ${usage_str} RAM (threshold: 1 GiB)"
      # Can't increment alerts in subshell, but the output itself is the alert
    fi
  done

  # Load average check (> number of cores is concerning)
  local load_1m cores
  load_1m=$(awk '{print $1}' /proc/loadavg)
  cores=$(nproc)
  local load_int
  load_int=$(echo "$load_1m" | awk '{printf "%d", $1}')
  if [ "$load_int" -gt "$cores" ]; then
    echo "WARNING: Load average ${load_1m} exceeds core count (${cores} cores)"
    alerts=$((alerts + 1))
  fi

  # If no alerts were printed, say so
  if [ "$alerts" -eq 0 ]; then
    # Check if any container alerts were printed (from subshell)
    # We re-check by looking at our own output — if nothing was printed above, all clear
    echo "All clear — no thresholds exceeded."
    echo "  CPU: ${cpu_pct}%  |  Memory: ${mem_pct}%  |  Disk: ${disk_pct}%  |  Load: ${load_1m}"
  fi
}

cmd_report() {
  echo "========================================================================"
  echo "  FULL PERFORMANCE REPORT — $(date)"
  echo "  Host: $(hostname) | Uptime: $(uptime -p)"
  echo "========================================================================"
  echo ""

  cmd_snapshot
  echo ""
  echo "------------------------------------------------------------------------"
  echo ""
  cmd_cpu
  echo ""
  echo "------------------------------------------------------------------------"
  echo ""
  cmd_memory
  echo ""
  echo "------------------------------------------------------------------------"
  echo ""
  cmd_disk
  echo ""
  echo "------------------------------------------------------------------------"
  echo ""
  cmd_docker
  echo ""
  echo "------------------------------------------------------------------------"
  echo ""
  cmd_network
  echo ""
  echo "------------------------------------------------------------------------"
  echo ""
  cmd_headroom
  echo ""
  echo "------------------------------------------------------------------------"
  echo ""
  cmd_alert
  echo ""
  echo "========================================================================"
  echo "  END OF REPORT"
  echo "========================================================================"
}

# ── USAGE ────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
performance-profiler — System performance profiling

COMMANDS:
  perf-profile.sh snapshot     Current system snapshot (CPU, memory, disk, load, top procs)
  perf-profile.sh cpu          Detailed CPU: per-core usage, load averages, top consumers
  perf-profile.sh memory       Memory breakdown: total, used, free, buffers, cache, swap
  perf-profile.sh disk         Disk usage: per-mount, inodes, largest dirs, Docker volumes
  perf-profile.sh docker       Docker per-container: CPU%, memory, network I/O, block I/O
  perf-profile.sh network      Network: bandwidth, connection counts, top connected IPs
  perf-profile.sh history      Show trends from recorded snapshot data
  perf-profile.sh headroom     Capacity planning: room for more containers?
  perf-profile.sh report       Full report (all of the above)
  perf-profile.sh alert        Check thresholds, only output warnings

THRESHOLDS (alert command):
  CPU > 80%  |  Memory > 85%  |  Disk > 85%  |  Container > 1GB RAM

HISTORY:
  Each 'snapshot' appends a JSON line to /root/overlord/data/perf-history.jsonl
  Use 'history' to view trends and averages.

EXAMPLES:
  perf-profile.sh snapshot     # Quick check + record history
  perf-profile.sh docker       # Which containers are heavy?
  perf-profile.sh headroom     # Can I add more projects?
  perf-profile.sh alert        # Anything to worry about?
  perf-profile.sh report       # Full picture
USAGE
}

# ── MAIN ─────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  snapshot)           cmd_snapshot ;;
  cpu)                cmd_cpu ;;
  memory|mem)         cmd_memory ;;
  disk)               cmd_disk ;;
  docker)             cmd_docker ;;
  network|net)        cmd_network ;;
  history)            cmd_history ;;
  headroom|capacity)  cmd_headroom ;;
  report|full)        cmd_report ;;
  alert|alerts)       cmd_alert ;;
  help|--help|-h)     usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: perf-profile.sh help"
    exit 1
    ;;
esac
