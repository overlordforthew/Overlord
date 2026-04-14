---
name: log-analyzer
version: 1.0.0
description: "Docker log analysis, error detection, pattern mining, and LLM-powered diagnosis across all containers."
---

# Log Analyzer

Analyze Docker container logs across the entire Hetzner infrastructure. Detects errors, groups patterns, monitors in real-time, and uses free LLM models for root cause analysis.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `log-analyzer.sh scan <container> [--lines N]` | Scan recent logs for errors/warnings (default 500 lines) |
| `log-analyzer.sh errors <container> [--since 1h]` | Extract ERROR/WARN/FATAL lines, dedup + count |
| `log-analyzer.sh traefik [--since 1h]` | Traefik access logs: 5xx counts, top error URLs, rate limits |
| `log-analyzer.sh health` | Quick scan ALL containers for recent errors (100 lines each) |
| `log-analyzer.sh diagnose <container>` | Feed errors to free LLM for root cause analysis |
| `log-analyzer.sh watch <container> [--interval 60]` | Tail logs, alert on error patterns (Ctrl+C to stop) |
| `log-analyzer.sh patterns <container> [--lines N]` | Group similar log lines, count occurrences |

## Usage

Scripts are at:
- Host: `/root/overlord/skills/log-analyzer/scripts/log-analyzer.sh`
- Container: `/app/skills/log-analyzer/scripts/log-analyzer.sh`

### Common Workflows

**Morning health check:**
```bash
log-analyzer.sh health
```

**Investigate a container with issues:**
```bash
log-analyzer.sh scan overlord --lines 1000
log-analyzer.sh errors overlord --since 6h
log-analyzer.sh diagnose overlord
```

**Traefik / reverse proxy analysis:**
```bash
log-analyzer.sh traefik --since 24h
```

**Find noisy log patterns:**
```bash
log-analyzer.sh patterns coolify-proxy --lines 2000
```

**Monitor a container in real-time:**
```bash
log-analyzer.sh watch overlord --interval 30
```

## What It Detects

| Pattern | Detection |
|---------|-----------|
| OOM kills | Code 137, SIGTERM, SIGKILL, out of memory |
| Baileys issues | DisconnectReason, connection closed, QR ref, stream errors |
| PostgreSQL | Connection refused, too many connections, deadlock, auth failures |
| Traefik | 5xx responses, rate limit hits, scanner bots (wp-admin, .env, .git) |
| Node.js | Unhandled rejections, TypeError, heap out of memory |
| Docker | Restart loops, unhealthy containers |

## Aliases

| Alias | Full command |
|-------|-------------|
| `errs` | `errors` |
| `proxy` | `traefik` |
| `diag` | `diagnose` |
| `patt` | `patterns` |

## Dependencies

- `docker` CLI (always available on host)
- `llm` CLI with OpenRouter (only for `diagnose` command): `llm -m openrouter/openrouter/free`

## When to Use

- After deploys to check for new errors
- Investigating slow or unresponsive services
- Daily/weekly health checks across all containers
- Tracing OOM kills or restart loops
- Analyzing Traefik for attack patterns or misrouted traffic
- Getting AI-assisted root cause analysis for unfamiliar errors
