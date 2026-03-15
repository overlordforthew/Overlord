---
name: security-scanner
version: 1.0.0
description: "Comprehensive security scanning for Hetzner CX33 — ports, SSL, headers, dependencies, Docker, fail2ban, SSH, and env file auditing."
---

# Security Scanner

Full-stack security auditing for the Overlord server. Checks ports, SSL certs, HTTP headers, npm dependencies, Docker config, fail2ban, SSH hardening, and environment file security.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `security-scan.sh ports` | Scan localhost for open ports, flag unexpected ones |
| `security-scan.sh ssl [domain]` | Check SSL cert expiry for all (or one) domain |
| `security-scan.sh headers [url]` | Check HTTP security headers (HSTS, CSP, etc.) |
| `security-scan.sh deps [project_dir]` | Run npm audit on one or all projects |
| `security-scan.sh docker` | Docker security: root users, privileged, exposed ports, image age |
| `security-scan.sh fail2ban` | Fail2ban jail stats, banned IPs, recent activity |
| `security-scan.sh ssh` | SSH config audit: password auth, root login, key enforcement |
| `security-scan.sh env-files` | Check .env permissions (600) and git exposure |
| `security-scan.sh full` | Run ALL checks, generate severity-rated summary report |

## Usage

Scripts are at:
- Host: `/root/overlord/skills/security-scanner/scripts/security-scan.sh`
- Container: `/app/skills/security-scanner/scripts/security-scan.sh`

### Full Scan

```bash
security-scan.sh full
```

Output format:
```
=== Security Scan Report ===
[PASS] Ports: No unexpected open ports detected
[HIGH] SSL: mastercommander.namibarden.com expires in 12 days
[PASS] Headers: All sites have HSTS
[MEDIUM] Deps: 3 moderate vulnerabilities in BeastMode
...
Summary: X critical, X high, X medium, X low, X pass
```

### Individual Checks

```bash
security-scan.sh ports
security-scan.sh ssl namibarden.com
security-scan.sh headers https://beastmode.namibarden.com
security-scan.sh deps /root/projects/BeastMode
security-scan.sh docker
security-scan.sh fail2ban
security-scan.sh ssh
security-scan.sh env-files
```

## Severity Levels

| Level | Meaning |
|-------|---------|
| CRITICAL | Immediate action required (expired SSL, password auth enabled, .env in git) |
| HIGH | Should fix soon (unexpected ports, missing fail2ban jails, bad .env perms) |
| MEDIUM | Worth investigating (missing headers, moderate npm vulns, 0.0.0.0 binds) |
| LOW | Minor improvements (default SSH port, containers as root, low npm vulns) |
| PASS | Check passed, no issues |

## Domains Checked

namibarden.com, beastmode.namibarden.com, lumina.namibarden.com, surfababe.namibarden.com, mastercommander.namibarden.com, onlyhulls.com, onlydrafting.com

## Dependencies

Uses only standard Ubuntu tools: `ss`, `openssl`, `curl`, `npm`, `docker`, `fail2ban-client`, `sshd`, `stat`, `find`, `jq`.

## When to Use

- Weekly security audit
- After deploying new services or opening ports
- After infrastructure changes (new domains, new containers)
- Before and after Traefik or fail2ban config changes
- When investigating suspicious activity
