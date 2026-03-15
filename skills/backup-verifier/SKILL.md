# Skill: Backup Verifier

## Scope
Verify integrity, completeness, and recoverability of nightly PostgreSQL backups stored in /root/backups/. Compares backups against live database containers.

## Scripts
- `scripts/backup-verify.sh` -- Main verification tool (6 commands)

## Commands

| Command | Description |
|---------|-------------|
| `check` | Check all backups: age, size, compression integrity |
| `verify <file>` | Deep verify: SQL counts, table list, row estimates |
| `compare <container>` | Compare latest backup vs live DB tables and row counts |
| `restore-test <file>` | Restore to temp DB, verify, drop -- proves recoverability |
| `schedule` | Show crontab backup entries and last run times |
| `report` | Full report: check + compare all containers + schedule |

## Usage
```bash
/root/overlord/skills/backup-verifier/scripts/backup-verify.sh check
/root/overlord/skills/backup-verifier/scripts/backup-verify.sh verify db-overlord-db-2026-03-15.sql.gz
/root/overlord/skills/backup-verifier/scripts/backup-verify.sh compare overlord-db
/root/overlord/skills/backup-verifier/scripts/backup-verify.sh restore-test db-overlord-db-2026-03-15.sql.gz
/root/overlord/skills/backup-verifier/scripts/backup-verify.sh report
```

## Known Containers
overlord-db, namibarden-db, surfababe-db, mastercommander-db, lumina-db, coolify-db, onlyhulls-db

## Safety
- `restore-test` creates a temp database named `_verify_temp_<timestamp>` and ALWAYS drops it (trap on EXIT)
- Never modifies production databases
- Uses `set -euo pipefail` throughout

## Dependencies
- docker (for `exec` into PG containers)
- gunzip (for integrity checks and decompression)
- Standard coreutils (stat, find, sort, grep)
- No psql on host -- all queries run via `docker exec`
