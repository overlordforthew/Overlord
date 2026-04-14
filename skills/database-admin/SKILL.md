---
name: database-admin
version: 1.0.0
description: "Unified PostgreSQL management across all project containers — discovery, monitoring, queries, backups, performance analysis."
---

# Database Admin

Manage all PostgreSQL instances across Overlord and project containers from a single tool.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `db-admin.sh list` | Discover all PG containers |
| `db-admin.sh health` | Health dashboard — all containers at once |
| `db-admin.sh databases <c>` | List databases with sizes |
| `db-admin.sh tables <c> [db]` | Tables with row counts and sizes |
| `db-admin.sh sizes <c> [db]` | Size report + index bloat detection |
| `db-admin.sh schema <c> <table> [db]` | Columns, indexes, stats for a table |
| `db-admin.sh connections <c>` | Active connections + long-running queries |
| `db-admin.sh slow <c> [db]` | Slow queries + sequential scan analysis |
| `db-admin.sh vacuum <c> [db]` | Dead tuple analysis |
| `db-admin.sh query <c> <sql> [db]` | Run SQL (blocks destructive unless `--force`) |
| `db-admin.sh backup <c> [dir]` | pg_dumpall to gzip |
| `db-admin.sh restore <c> <file>` | Show restore instructions |

## Known Containers

| Container | User | Database | Project |
|-----------|------|----------|---------|
| `overlord-db` | overlord | overlord | Overlord (memories, conversations) |
| Lumina PG | (auto-detected) | lumina | Lumina auth system |
| MC PG | (auto-detected) | mastercommander | MasterCommander boat monitor |
| NamiBarden PG | (auto-detected) | namibarden | NamiBarden website |
| SurfaBabe PG | (auto-detected) | surfababe | SurfaBabe wellness |
| Plausible PG | (auto-detected) | plausible | PlausibleAnalytics |

## Usage

Scripts are at:
- Host: `/root/overlord/skills/database-admin/scripts/db-admin.sh`
- Container: `/app/skills/database-admin/scripts/db-admin.sh`

### Common Workflows

**Daily health check:**
```bash
db-admin.sh health
```

**Investigate a slow endpoint:**
```bash
db-admin.sh slow overlord-db overlord
db-admin.sh connections overlord-db
```

**Check table growth:**
```bash
db-admin.sh sizes overlord-db overlord
db-admin.sh tables overlord-db overlord
```

**Inspect table schema:**
```bash
db-admin.sh schema overlord-db conversations overlord
db-admin.sh schema overlord-db usage_stats overlord
```

**Run a query:**
```bash
db-admin.sh query overlord-db "SELECT COUNT(*) FROM conversations" overlord
```

**Backup a container:**
```bash
db-admin.sh backup overlord-db /root/backups
```

## Safety

- Destructive SQL (DROP, DELETE, TRUNCATE, ALTER, UPDATE) is blocked by default
- Pass `--force` as 4th argument to override: `db-admin.sh query <c> "DELETE FROM ..." <db> --force`
- `restore` only prints instructions — never auto-restores

## When to Use

- Checking database health across all projects
- Investigating slow queries or connection issues
- Analyzing table sizes and index efficiency
- Running ad-hoc SQL queries against any project database
- Creating backups before migrations or deploys
- Checking vacuum status and dead tuple buildup
