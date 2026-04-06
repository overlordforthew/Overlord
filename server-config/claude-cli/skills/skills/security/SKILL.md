---
name: security
version: 1.0.0
description: |
  Unified security check — infrastructure, code, dependencies, and optional active pentest
  in one command. Chains /audit (infra), security-reviewer (code OWASP), dependency CVEs,
  container hardening, and optionally /shannon (active pentest) into a single graded report.
  Use when: "security", "full security check", "security scan", "check everything security",
  "comprehensive audit". (Overlord Stack)
argument-hint: "[project-name] [--full]"
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# /security — Unified Security Check

One command, full coverage. Runs 4 phases (5 with `--full`), produces a combined report
with a single letter grade.

## Parse Arguments

Parse `$ARGUMENTS`:
- **Project name** (optional): `overlord`, `namibarden`, `lumina`, etc. Defaults to detecting
  the project from `pwd` or scanning `/root/overlord` if at `/root`.
- **`--full`**: Include Shannon active pentest (Phase 5). Without it, phases 1-4 only.
- **`--project-path /path`**: Override project path detection.

Resolve project name to path using the table in CLAUDE.md. If no project identified and not
in a project directory, run infra-only (phases 1 and 3).

## Phase 1: Infrastructure Scan

> Covers: exposed ports, firewall, SSH, fail2ban, .env permissions, Traefik config, container bindings

Run all checks in parallel:

### 1.1 Exposed Ports
```bash
ss -tlnp | grep -v "127.0.0.1" | grep -v "::1"
```
Expected: Only 22 (SSH), 80 (HTTP), 443 (HTTPS). Flag anything else.

### 1.2 Container Audit
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null
```
Check:
- Containers binding to `0.0.0.0` (should be `127.0.0.1` only)
- Containers in restart loops
- Containers running as root without justification

```bash
docker inspect --format '{{.Config.User}} {{.Name}}' $(docker ps -q) 2>/dev/null
```

### 1.3 Fail2ban
```bash
fail2ban-client status 2>/dev/null
for jail in sshd traefik-auth traefik-botsearch traefik-ratelimit; do
  echo "=== $jail ===" && fail2ban-client status $jail 2>/dev/null | tail -3
done
```
Expected: 4 active jails.

### 1.4 SSH Hardening
```bash
grep -E "^(PasswordAuthentication|PermitRootLogin|Port|AllowUsers|AllowGroups)" /etc/ssh/sshd_config 2>/dev/null
grep -rE "^(PasswordAuthentication|PermitRootLogin)" /etc/ssh/sshd_config.d/ 2>/dev/null
```
Expected: `PasswordAuthentication no`, key-only auth.

### 1.5 .env Permissions
```bash
find /root -maxdepth 4 -name ".env" -exec stat -c "%a %U %n" {} \; 2>/dev/null
```
Expected: `600` (owner read/write only). Flag anything more permissive.

### 1.6 Traefik Configuration
```bash
cat /data/coolify/proxy/dynamic/namibarden.yaml 2>/dev/null
```
Check:
- Routes without TLS
- Endpoints missing auth middleware where expected
- Unexpected backend targets

### 1.7 UFW / Firewall
```bash
ufw status verbose 2>/dev/null | head -30
```

## Phase 2: Code Security Review (OWASP Top 10)

> Covers: injection, auth, data exposure, input handling, infrastructure-specific patterns

Spawn the `security-reviewer` agent against the project directory. The agent checks:

- **Injection**: SQL, command, NoSQL, template injection
- **Auth & Sessions**: Missing auth, broken authz, IDOR, hardcoded credentials, JWT flaws
- **Data Exposure**: Secrets in logs, verbose errors, over-exposed API responses
- **Input Handling**: XSS (reflected/stored/DOM), path traversal, unvalidated redirects, file upload
- **Infrastructure**: Docker bindings, Traefik routes missing auth, Express rate limiting, unsanitized WhatsApp input, Claude CLI spawns with unescaped content

```
Use Agent tool with subagent_type="security-reviewer":
  "Run a full OWASP Top 10 + infrastructure security review on [project-path].
   Check all source files. Report findings as CRITICAL / WARNING / INFO / CLEAN.
   Include file:line references for every finding."
```

## Phase 3: Dependency & Supply Chain

> Covers: known CVEs in dependencies, outdated packages, lockfile integrity

Run in the project directory:

### 3.1 Node.js
```bash
[ -f package-lock.json ] && npm audit --json 2>/dev/null | node -e "
  const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const v = d.vulnerabilities || {};
  const counts = {critical:0,high:0,moderate:0,low:0};
  Object.values(v).forEach(x => counts[x.severity]= (counts[x.severity]||0)+1);
  console.log(JSON.stringify(counts));
  Object.entries(v).filter(([,x]) => x.severity==='critical'||x.severity==='high')
    .forEach(([name,x]) => console.log(x.severity.toUpperCase(), name, x.range, x.title));
" 2>/dev/null
```

### 3.2 Python
```bash
[ -f requirements.txt ] && pip audit 2>/dev/null | head -30
```

### 3.3 Go
```bash
[ -f go.sum ] && govulncheck ./... 2>/dev/null | head -30
```

### 3.4 Lockfile Integrity
```bash
# Check that lockfile exists if package.json does
[ -f package.json ] && [ ! -f package-lock.json ] && [ ! -f yarn.lock ] && echo "WARN: No lockfile found"
```

## Phase 4: Container Hardening

> Covers: Dockerfile best practices, runtime security, network isolation

### 4.1 Dockerfile Review (if present)
```bash
[ -f Dockerfile ] && cat Dockerfile
[ -f docker-compose.yml ] && cat docker-compose.yml
```
Check:
- Running as root without need
- `latest` tags instead of pinned versions
- Secrets passed as build args
- Unnecessary capabilities or privileged mode
- Healthcheck defined

### 4.2 Runtime Config
```bash
# Check for privileged containers or dangerous capabilities
docker inspect $(docker ps -q) --format '{{.Name}} privileged={{.HostConfig.Privileged}} caps={{.HostConfig.CapAdd}}' 2>/dev/null
```

### 4.3 Network Isolation
```bash
# Verify containers are on expected networks
docker network ls --format "{{.Name}}" 2>/dev/null
docker inspect $(docker ps -q) --format '{{.Name}} {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null
```

## Phase 5: Active Pentest (only with --full)

> Covers: live exploitation attempts, 6 parallel vuln agents, hygiene scorecard

Only runs when `--full` is passed. This is Shannon — it takes 15-45 minutes and actively
probes the running application.

```
Launch /shannon against the project:
  ./shannon start URL=<url> REPO=<project-name>
```

Tell the user:
- Shannon is launching (15-45 min runtime)
- Provide the workflow ID and Temporal UI link
- Results will be appended to the report when complete

If Shannon is not available (container not running), skip and note it in the report.

## Phase 6: Combined Report

Aggregate all findings into a single report:

```
SECURITY REPORT — [project] — [date]
======================================

GRADE: [A-F]

INFRASTRUCTURE (Phase 1)
  Exposed ports .......... [OK / CRITICAL: details]
  Container bindings ..... [OK / HIGH: details]
  Fail2ban ............... [OK / WARN: details]
  SSH hardening .......... [OK / WARN: details]
  .env permissions ....... [OK / HIGH: details]
  Traefik config ......... [OK / WARN: details]
  Firewall ............... [OK / WARN: details]

CODE SECURITY (Phase 2)
  Injection .............. [CLEAN / N findings]
  Auth & Sessions ........ [CLEAN / N findings]
  Data Exposure .......... [CLEAN / N findings]
  Input Handling ......... [CLEAN / N findings]
  Infra-Specific ......... [CLEAN / N findings]

DEPENDENCIES (Phase 3)
  Critical CVEs .......... [0 / N]
  High CVEs .............. [0 / N]
  Moderate CVEs .......... [0 / N]
  Lockfile ............... [OK / MISSING]

CONTAINER HARDENING (Phase 4)
  Dockerfile ............. [OK / N issues]
  Runtime config ......... [OK / N issues]
  Network isolation ...... [OK / N issues]

[If --full:]
ACTIVE PENTEST (Phase 5)
  Shannon status ......... [Complete / In Progress / Skipped]
  Hygiene grade .......... [A-F]
  Exploitable findings ... [0 / N]

─────────────────────────────────────
FINDINGS BY SEVERITY

CRITICAL (fix immediately)
  [#] [phase] [file:line or component] Description
      Risk: ...
      Fix: ...

HIGH (fix today)
  [#] [phase] [file:line or component] Description
      Risk: ...
      Fix: ...

MEDIUM (fix this week)
  [#] ...

LOW (informational)
  [#] ...

─────────────────────────────────────
SUMMARY: N critical, N high, N medium, N low
GRADE: [letter]
```

### Grading Rubric

| Grade | Criteria |
|-------|----------|
| **A** | 0 critical, 0 high, ≤2 medium |
| **B** | 0 critical, ≤2 high, ≤5 medium |
| **C** | 0 critical, ≤5 high, any medium |
| **D** | 1-2 critical OR >5 high |
| **F** | 3+ critical OR actively exploitable finding |

### Severity Definitions

- **CRITICAL**: Actively exploitable — exposed secrets, open admin ports, SQL injection with data access, RCE
- **HIGH**: Exploitable with effort — permissive .env, missing auth on internal endpoint, stored XSS
- **MEDIUM**: Known CVEs in deps, containers as root in isolated network, missing rate limits
- **LOW**: Informational — outdated but non-vulnerable deps, style issues, missing CSP headers

## Execution Notes

- Run Phase 1 checks in parallel (all infrastructure commands at once)
- Run Phase 2 (security-reviewer agent) in parallel with Phase 1
- Run Phase 3 and Phase 4 after Phase 2 completes (needs project context)
- Phase 5 (Shannon) is async — launch it and note "pending" in the report
- For any CRITICAL finding, include the exact fix command or code change
- If a phase fails to run (missing tool, container down), mark it as SKIPPED with reason
- Total runtime without --full: ~2-3 minutes. With --full: 15-45 minutes (Shannon)
