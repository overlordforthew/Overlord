---
name: git-intelligence
version: 1.0.0
description: "Cross-repo git analytics, dependency auditing, security scanning, and PR tracking across all bluemele projects."
---

# Git Intelligence

Monitor and analyze all 8 project repos from a single tool: status, activity, stale branches, sizes, dependency audits, secret scanning, and GitHub PR tracking.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `git-intel.sh status` | Branch, dirty files, ahead/behind for all repos |
| `git-intel.sh activity [--days N]` | Recent commits across all repos (default: 7 days) |
| `git-intel.sh stale` | Branches with no commits in 30+ days |
| `git-intel.sh size` | Disk usage, commit counts, largest files per repo |
| `git-intel.sh deps [project]` | npm audit for one or all projects |
| `git-intel.sh security` | npm audit + secret leak scan (last 20 commits) |
| `git-intel.sh prs` | Open PRs across all repos (GitHub API) |
| `git-intel.sh report` | Full weekly digest combining all commands |

## Repos Scanned

| Project | Path |
|---------|------|
| Overlord | `/root/overlord` |
| NamiBarden | `/root/projects/NamiBarden` |
| MasterCommander | `/root/projects/MasterCommander` |
| BeastMode | `/root/projects/BeastMode` |
| Lumina | `/root/projects/Lumina` |
| SurfaBabe | `/root/projects/SurfaBabe` |
| Elmo | `/root/projects/Elmo` |
| OnlyHulls | `/root/projects/OnlyHulls` |

## Usage

Script path:
- `/root/overlord/skills/git-intelligence/scripts/git-intel.sh`

### Common Workflows

**Morning check — what changed overnight:**
```bash
git-intel.sh status
git-intel.sh activity --days 1
```

**Weekly review:**
```bash
git-intel.sh report
```

**Audit a specific project:**
```bash
git-intel.sh deps Lumina
```

**Security sweep:**
```bash
git-intel.sh security
```

**Check open PRs:**
```bash
git-intel.sh prs
```

## Dependencies

- `git`, `npm`, `curl`, `jq` (all pre-installed)
- `GH_TOKEN` in `/root/overlord/.env` (required for `prs` command)

## Security Scan Details

The `security` command checks two things:
1. **npm audit** across all repos with package.json
2. **Secret leak scan** in the last 20 commits per repo, matching patterns like `password=`, `secret=`, `api_key=`, `token=`, `private_key`. Excludes `.env` and lock files. Flags occurrences without printing actual values.
