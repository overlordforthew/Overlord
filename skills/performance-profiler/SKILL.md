---
name: performance-profiler
version: 1.0.0
description: "System performance profiling, capacity planning, and threshold alerts for Hetzner CX33 (4-core AMD EPYC, 8GB RAM, 80GB SSD)."
---

# Performance Profiler

Profile system performance, track trends, estimate capacity, and check alert thresholds. Uses only standard Linux tools — no external dependencies.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `perf-profile.sh snapshot` | System snapshot: CPU, memory, disk, load, top processes. Records to history. |
| `perf-profile.sh cpu` | Per-core CPU usage, load averages, top CPU consumers |
| `perf-profile.sh memory` | Memory breakdown: total, used, free, available, buffers, cache, swap |
| `perf-profile.sh disk` | Disk usage: per-mount, inodes, largest dirs under /root, Docker volumes |
| `perf-profile.sh docker` | Per-container CPU%, memory, network I/O, block I/O |
| `perf-profile.sh network` | Bandwidth per interface, connection counts by state, top IPs |
| `perf-profile.sh history` | Trends and averages from recorded snapshots |
| `perf-profile.sh headroom` | Capacity planning: how many more containers can fit? |
| `perf-profile.sh report` | Full report combining all commands |
| `perf-profile.sh alert` | Threshold warnings only (CPU >80%, Mem >85%, Disk >85%, container >1GB) |

## Usage

Scripts are at:
- Host: `/root/overlord/skills/performance-profiler/scripts/perf-profile.sh`
- Container: `/app/skills/performance-profiler/scripts/perf-profile.sh`

### Common Workflows

**Quick health check:**
```bash
perf-profile.sh snapshot
```

**Before deploying a new project:**
```bash
perf-profile.sh headroom
```

**Investigate high resource usage:**
```bash
perf-profile.sh docker
perf-profile.sh cpu
perf-profile.sh memory
```

**Check if anything needs attention:**
```bash
perf-profile.sh alert
```

**Full system audit:**
```bash
perf-profile.sh report
```

**View trends over time:**
```bash
perf-profile.sh history
```

## History Tracking

Each `snapshot` command appends a JSON line to `/root/overlord/data/perf-history.jsonl` with:
- `ts` — UTC timestamp
- `cpu_pct` — CPU usage percentage
- `mem_pct` — Memory usage percentage
- `disk_pct` — Root disk usage percentage
- `load_1m` — 1-minute load average

The `history` command shows recent entries, averages, and peak values.

## Alert Thresholds

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| CPU | > 80% | Leave headroom for traffic spikes |
| Memory | > 85% | 8GB total, OOM risk above this |
| Disk | > 85% | 80GB SSD fills fast with Docker images |
| Container RAM | > 1 GB | Single container shouldn't dominate on 8GB server |
| Load average | > core count (4) | System is oversubscribed |

## Dependencies

None. Uses only standard Linux tools:
- `/proc/stat`, `/proc/meminfo`, `/proc/loadavg` — kernel stats
- `ps`, `df`, `du`, `ss`, `uptime`, `nproc` — coreutils/iproute2
- `docker stats`, `docker system df` — Docker CLI
- `awk`, `sed`, `sort` — text processing

## When to Use

- Checking system health before or after deployments
- Investigating slow response times or high resource usage
- Planning whether the server can handle another project
- Building a baseline of normal resource usage over time
- Automated monitoring via cron (run `snapshot` periodically)
