# Performance Patterns

## Server Resources (Hetzner CX33)
- 4-core AMD EPYC, 8GB RAM, 80GB SSD
- Typical usage: 60-75% memory, 40-60% disk
- Critical thresholds: memory >85% (swap thrashing), disk >80% (builds fail)

## Response Time Baselines
- Simple messages (greetings, quick lookups): 5-15 seconds
- Medium tasks (research, analysis): 30-90 seconds
- Complex tasks (code changes, multi-file edits): 2-7 minutes
- If response times exceed 2x baseline consistently, investigate: memory pressure, model latency, or network issues

## Timeout Tuning (current values)
- maxResponseTime: 600s (10 min) — Opus with heavy tool use
- chatResponseTimeout: 420s (7 min) — Opus moderate tool use
- simpleResponseTimeout: 240s (4 min) — Opus light tool use
- Previous values were lower (5min/3min/2min) and caused chronic timeouts. Bumped after repeated SIGTERM issues.

## Memory Management
- Overlord container: 4GB limit. Node.js process typically uses 400-800MB.
- Work queue isolates heavy tasks: simple (512MB), medium (768MB), complex (1.2GB)
- Claude CLI processes spawn as children — each can use 500MB-1.5GB depending on context size
- Maximum safe concurrent Claude CLI processes: 2 (with memory-isolated execution)

## Docker Disk Usage
- Images accumulate. Run `docker image prune -f` monthly to reclaim space.
- Build cache grows with Coolify rebuilds. `docker builder prune` if disk pressure.
- Log rotation: Docker defaults can fill disk. Check `/var/lib/docker/containers/*/` for large log files.
