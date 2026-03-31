---
name: health
version: 1.0.0
description: |
  Server health dashboard. RAM/disk/CPU, container statuses, fail2ban stats, Traefik
  routes, port checks, recent errors across all projects. Full server picture in 30 seconds.
  Use when: "health", "server status", "how's the server", "check everything",
  "system status", "dashboard". (Overlord Stack)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
---

# /health -- Server Health Dashboard

Full server status in one sweep. Run this after deploys, after incidents, or first thing in the morning.

## System Resources

```bash
echo "=== RESOURCES ==="
echo "--- Memory ---"
free -h
echo ""
echo "--- Disk ---"
df -h / /data 2>/dev/null || df -h /
echo ""
echo "--- CPU ---"
uptime
echo ""
echo "--- Top Processes by Memory ---"
ps aux --sort=-%mem | head -8
```

Flag if:
- RAM usage > 85% (server has 8GB total)
- Disk usage > 80%
- Load average > 4.0 (4-core CPU)

## Container Status

```bash
echo "=== CONTAINERS ==="
docker ps -a --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
echo ""
echo "--- Container Memory ---"
docker stats --no-stream --format "table {{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}" 2>/dev/null
```

Check for:
- Containers in "Restarting" or "Exited" state
- Overlord container memory near 2GB limit
- Missing expected containers

Expected containers:
- `overlord` (WhatsApp bot)
- `overlord-db` (PostgreSQL 17)
- `lightpanda` (headless browser)
- Traefik proxy
- Coolify-managed containers (BeastMode, Lumina, Elmo, OnlyHulls, etc.)

## Network & Ports

```bash
echo "=== NETWORK ==="
echo "--- Listening Ports (non-localhost) ---"
ss -tlnp | grep -v "127.0.0.1" | grep -v "::1" | grep -v "LISTEN"
ss -tlnp | grep "LISTEN" | grep -v "127.0.0.1" | grep -v "::1"
echo ""
echo "--- Tailscale ---"
tailscale status 2>/dev/null | head -5
```

## Security

```bash
echo "=== SECURITY ==="
echo "--- Fail2ban ---"
fail2ban-client status 2>/dev/null
echo ""
for jail in sshd traefik-auth traefik-botsearch traefik-ratelimit; do
  BANNED=$(fail2ban-client status "$jail" 2>/dev/null | grep "Currently banned" | awk '{print $NF}')
  TOTAL=$(fail2ban-client status "$jail" 2>/dev/null | grep "Total banned" | awk '{print $NF}')
  echo "$jail: $BANNED currently banned ($TOTAL total)"
done
echo ""
echo "--- Recent SSH Attempts ---"
journalctl -u sshd --since "1 hour ago" --no-pager 2>/dev/null | grep -c "Failed" || echo "0 failed"
```

## Project Health

Quick log check across all running projects:

```bash
echo "=== PROJECT LOGS (last 5 lines each) ==="
for container in overlord; do
  echo "--- $container ---"
  docker logs "$container" --tail 5 2>&1 | tail -5
  echo ""
done
```

Check web endpoints:

```bash
echo "=== ENDPOINTS ==="
for url in \
  "https://namibarden.com" \
  "https://beastmode.namibarden.com" \
  "https://lumina.namibarden.com" \
  "https://surfababe.namibarden.com" \
  "https://mastercommander.namibarden.com" \
  "https://onlydrafting.com" \
  "https://onlyhulls.com"; do
  STATUS=$(curl -sI --max-time 5 "$url" 2>/dev/null | head -1 | awk '{print $2}')
  echo "$url -> ${STATUS:-TIMEOUT}"
done
```

## Overlord Specific

```bash
echo "=== OVERLORD ==="
# WhatsApp connection status
docker logs overlord --tail 30 2>&1 | grep -iE "(connected|disconnected|reconnect|error|SIGTERM|OOM)" | tail -5
echo ""
# DB status
docker exec overlord-db pg_isready 2>/dev/null && echo "PostgreSQL: OK" || echo "PostgreSQL: DOWN"
echo ""
# Memory DB
docker exec overlord ls -la /app/data/memory-v2.db 2>/dev/null | awk '{print "Memory DB:", $5, "bytes"}'
```

## Report

```
SERVER HEALTH -- [date] [time]
===============================

RESOURCES
  RAM:      [X/8GB] [OK/WARNING/CRITICAL]
  Disk:     [X/80GB] [OK/WARNING]
  CPU Load: [X] [OK/HIGH]

CONTAINERS
  Running:  N/M expected
  Issues:   [none / list]

SECURITY
  Fail2ban: N jails active, N currently banned
  SSH:      N failed attempts last hour
  Ports:    [OK / unexpected: list]

ENDPOINTS
  [domain] -> [status]
  ...

OVERLORD
  WhatsApp: [connected/disconnected]
  Database: [OK/DOWN]
  Memory:   [size]

VERDICT: [ALL CLEAR / N issues need attention]
```

For any issue found, include the fix command or next step.
