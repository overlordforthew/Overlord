---
name: audit
version: 1.0.0
description: |
  Quick infrastructure security audit. Checks exposed ports, .env permissions, Traefik
  routes, fail2ban status, container configs, secrets in code, dependency vulnerabilities.
  Lighter and faster than /shannon (full pentest). Use when: "quick audit", "security check",
  "audit", "check security", "are we exposed". (Overlord Stack)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# /audit -- Quick Security Audit

Fast, infra-aware security check for this server. Not a pentest (use /shannon for that).
This is the 5-minute sweep you run after config changes or before sleep.

## Phase 1: Infrastructure Scan

Run all checks in parallel where possible.

### 1.1 Exposed Ports
```bash
ss -tlnp | grep -v "127.0.0.1" | grep -v "::1"
```
Expected: Only ports 22 (SSH), 80 (Traefik HTTP), 443 (Traefik HTTPS) should be exposed.
Flag anything else.

### 1.2 Container Status
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
```
Check for:
- Containers binding to 0.0.0.0 (should be 127.0.0.1 only, Traefik handles public)
- Containers in restart loops
- Unexpected containers

### 1.3 Fail2ban Status
```bash
fail2ban-client status 2>/dev/null
fail2ban-client status sshd 2>/dev/null | tail -3
fail2ban-client status traefik-auth 2>/dev/null | tail -3
fail2ban-client status traefik-botsearch 2>/dev/null | tail -3
fail2ban-client status traefik-ratelimit 2>/dev/null | tail -3
```
Expected: 4 active jails (sshd, traefik-auth, traefik-botsearch, traefik-ratelimit).

### 1.4 SSH Config
```bash
grep -E "^(PasswordAuthentication|PermitRootLogin|Port)" /etc/ssh/sshd_config 2>/dev/null
```
Expected: PasswordAuthentication no, key-only auth.

### 1.5 .env File Permissions
```bash
find /root -maxdepth 3 -name ".env" -exec stat -c "%a %U %n" {} \; 2>/dev/null
```
Expected: 600 (owner read/write only). Flag anything more permissive.

### 1.6 Traefik Config
```bash
cat /data/coolify/proxy/dynamic/namibarden.yaml 2>/dev/null | head -50
```
Check for:
- Routes pointing to unexpected backends
- Missing TLS configuration
- Open endpoints without auth

## Phase 2: Code Scan (current project)

If in a project directory:

### 2.1 Secrets in Code
```bash
git log --diff-filter=A --name-only --pretty="" HEAD~20..HEAD 2>/dev/null | sort -u | head -30
```

Search for hardcoded secrets in tracked files:
- API keys, tokens, passwords in source code
- Private keys or certificates
- Database connection strings with passwords

### 2.2 Dependency Audit
```bash
# Node.js
[ -f package-lock.json ] && npm audit --json 2>/dev/null | head -50
[ -f yarn.lock ] && yarn audit --json 2>/dev/null | head -50

# Python
[ -f requirements.txt ] && pip audit 2>/dev/null | head -30
```

### 2.3 Docker Security
```bash
# Check if containers run as root
docker inspect --format '{{.Config.User}} {{.Name}}' $(docker ps -q) 2>/dev/null
```

## Phase 3: Report

Generate a report card:

```
SECURITY AUDIT -- [date]
========================

INFRASTRUCTURE
  Exposed ports:    [OK / ISSUE: details]
  Containers:       [OK / ISSUE: details]
  Fail2ban:         [OK / ISSUE: details]  (N currently banned IPs)
  SSH:              [OK / ISSUE: details]
  .env permissions: [OK / ISSUE: details]
  Traefik:          [OK / ISSUE: details]

CODE (if in project)
  Secrets scan:     [OK / ISSUE: details]
  Dependencies:     [OK / N vulnerabilities found]
  Docker config:    [OK / ISSUE: details]

VERDICT: [CLEAN / N issues found]
```

Rate each finding:
- **CRITICAL** -- Actively exploitable, fix now (exposed secrets, open ports with services)
- **HIGH** -- Should fix today (permissive .env, missing fail2ban jail)
- **MEDIUM** -- Fix this week (outdated deps with known CVEs)
- **LOW** -- Informational (containers running as root in isolated network)

For any CRITICAL or HIGH finding, include the exact fix command.
