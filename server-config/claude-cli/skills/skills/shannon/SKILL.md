---
name: shannon
description: "Launch and monitor Shannon AI penetration tests. Full pipeline: recon, 6 parallel vulnerability agents (injection, XSS, auth, SSRF, authz, hygiene), conditional exploitation, executive report. Use when user says 'shannon', 'security audit', 'pentest', 'hygiene check', or 'audit <project>'."
argument-hint: "<project-name-or-url> [options]"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Agent
compatibility: Requires Shannon project at /root/projects/shannon with Docker.
metadata:
  author: Gil Barden / Overlord
  version: "2026-03-22"
---

# Shannon — AI Penetration Testing Framework

Full-pipeline pentest: pre-recon, recon, 6 parallel vulnerability agents (injection, XSS, auth, SSRF, authz, hygiene), conditional exploitation, and executive security report.

## Parse Arguments

Parse `$ARGUMENTS` to determine the target. Accept any of:
- Project name: `lumina`, `namibarden`, `onlyhulls`, etc.
- URL: `https://lumina.namibarden.com`
- Both: `lumina https://lumina.namibarden.com`
- With options: `lumina WORKSPACE=q1-audit`

**Known projects** — resolve name to URL + repo path:

| Name | Repo Path | URL |
|------|-----------|-----|
| namibarden | /root/projects/NamiBarden | https://namibarden.com |
| lumina | /root/projects/Lumina | https://lumina.namibarden.com |
| surfababe | /root/projects/SurfaBabe | https://surfababe.namibarden.com |
| mastercommander | /root/projects/MasterCommander | https://mastercommander.namibarden.com |
| onlyhulls | /root/projects/OnlyHulls | https://onlyhulls.com |
| elmo | /root/projects/Elmo | https://onlydrafting.com |
| beastmode | /root/projects/BeastMode | https://beastmode.namibarden.com |

If the project is unknown, ask the user for both the URL and repo path.

## Setup

1. **Ensure repo is symlinked** into Shannon's repos directory:

```bash
# Check if symlink exists
ls -la /root/projects/shannon/repos/<project-name>

# If not, create it
ln -sf <repo-path> /root/projects/shannon/repos/<project-name>
# NOTE: Shannon mounts ./repos into the worker container. Symlinks to host paths
# (e.g. /root/projects/X) will NOT resolve inside the container. Either:
# - Copy the repo: cp -r <path> ./repos/<name>
# - Or use existing repos (ls ./repos/ to see what is already available)
```

2. **Check for a config file** (optional — enhances the scan):

```bash
ls /root/projects/shannon/configs/<project-name>.yaml 2>/dev/null
```

If one exists, pass it with `CONFIG=./configs/<project-name>.yaml`. If not, Shannon will still work — it just won't have login credentials or scope restrictions.

## Launch Pipeline

```bash
./shannon start URL=<url> REPO=<project-name> [CONFIG=./configs/<name>.yaml] [WORKSPACE=<name>] [OUTPUT=<path>]
```

Useful options:
- `WORKSPACE=<name>` — Named workspace. Auto-resumes if a previous run exists under that name.
- `CONFIG=<path>` — YAML config with auth credentials, scope restrictions, focus areas.
- `OUTPUT=<path>` — Custom output directory (default: `./audit-logs/`).
- `PIPELINE_TESTING=true` — Use minimal prompts for fast testing.

Tell the user the pipeline is launching. It runs autonomously through all phases:

```
Phase 1: Pre-Reconnaissance (source code analysis)
Phase 2: Reconnaissance (attack surface mapping)
Phase 3: Vulnerability Analysis (6 agents in parallel)
   - injection, xss, auth, ssrf, authz, hygiene
Phase 4: Exploitation (conditional — only for confirmed vulnerabilities)
Phase 5: Executive Report
```

## Monitor Progress

After launching, monitor the pipeline:

```bash
# Tail live logs
cd /root/projects/shannon && ./shannon logs ID=<workflow-id>

# Or check Temporal UI
# http://localhost:8233
```

The workflow ID is printed when `./shannon start` completes. Use it to tail logs.

Provide the user with:
1. The workflow ID
2. Temporal UI link: `http://localhost:8233`
3. Estimated runtime: 15-45 minutes depending on app complexity

## Check Results

When the pipeline completes, results are in the workspace's deliverables directory:

```bash
# List all deliverables
ls /root/projects/shannon/audit-logs/<workspace>/deliverables/

# Key files:
# - comprehensive_security_assessment_report.md  (executive report)
# - hygiene_analysis_deliverable.md              (20-point scorecard)
# - injection_analysis_deliverable.md            (SQL/NoSQL/command injection)
# - xss_analysis_deliverable.md                  (cross-site scripting)
# - auth_analysis_deliverable.md                 (authentication vulnerabilities)
# - ssrf_analysis_deliverable.md                 (server-side request forgery)
# - authz_analysis_deliverable.md                (authorization/access control)
# - *_exploitation_evidence.md                   (proof-of-concept exploits)
```

Read and present the executive report to the user. Highlight:
- Critical/High severity findings
- The hygiene scorecard grade (A-F)
- Any successful exploitations

## Pipeline Agents — What Each Does

| Agent | Focus | Method |
|-------|-------|--------|
| **pre-recon** | Source code architecture, tech stack, entry points | Code analysis (Task Agent) |
| **recon** | Attack surface mapping, endpoints, data flows | Code + Playwright browser |
| **injection-vuln** | SQL, NoSQL, OS command, template injection | Code + Playwright |
| **xss-vuln** | Reflected, stored, DOM-based XSS | Code + Playwright |
| **auth-vuln** | Auth bypass, session flaws, credential issues | Code + Playwright |
| **ssrf-vuln** | Server-side request forgery, SSRF via redirects | Code + Playwright |
| **authz-vuln** | IDOR, privilege escalation, access control gaps | Code + Playwright |
| **hygiene-vuln** | 20-point vibe-code antipattern checklist | Code + Playwright |
| **report** | Executive security assessment | Aggregates all findings |

The hygiene agent checks: rate limiting, localStorage tokens, input sanitisation, hardcoded keys, Stripe webhook verification, CORS, DB indexing, pagination, connection pooling, session expiry, password reset expiry, admin role checks, health endpoints, env validation, error boundaries, CDN usage, async emails, structured logging, backups, TypeScript.

## Troubleshooting

```bash
# Containers not starting?
cd /root/projects/shannon && docker compose ps

# Rebuild from scratch
./shannon stop CLEAN=true && ./shannon start URL=<url> REPO=<name> REBUILD=true

# Check worker logs directly
docker compose -f docker-compose.yml logs worker --tail 50
```
