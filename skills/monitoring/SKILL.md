# Skill: Monitoring & Alerts

## Scope
Service health monitoring, container alerts, disk/memory warnings, SSL cert checks.

## Available Tools

### service-check.sh
Checks all running services and reports status.
```bash
/app/skills/monitoring/service-check.sh          # Full check
/app/skills/monitoring/service-check.sh --brief   # One-line summary
```

### ssl-check.sh
Checks SSL certificate expiry for all domains.
```bash
/app/skills/monitoring/ssl-check.sh
```

### disk-alert.sh
Checks disk and memory usage, warns if thresholds exceeded.
```bash
/app/skills/monitoring/disk-alert.sh              # Default: warn at 80%
/app/skills/monitoring/disk-alert.sh 90            # Custom threshold
```

## Cron Integration
These scripts can be added to crontab for automatic monitoring.
Alerts are written to /app/logs/alerts.log — check this file for recent warnings.

## When to Use
- User asks "how are my services doing?" or "is everything running?"
- User asks about disk space, memory, or SSL certs
- Proactive: run service-check.sh at start of admin sessions
