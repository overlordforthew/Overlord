#!/bin/bash
# backup.sh — Backup critical files
# Stores in ~/backups/ with date stamps, keeps last 7 days

set -euo pipefail

BACKUP_DIR="/root/backups"
DATE=$(date +%Y-%m-%d)
LOG_TAG="[backup]"

log() { echo "$LOG_TAG $(date -u '+%H:%M:%S') $*"; }

mkdir -p "$BACKUP_DIR"

# Backup Overlord workspace (excluding node_modules, auth, media, .git)
log "Backing up Overlord workspace..."
tar czf "$BACKUP_DIR/overlord-$DATE.tar.gz" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='media' \
    -C /home/gil overlord/ 2>/dev/null
log "Overlord workspace: $(du -sh "$BACKUP_DIR/overlord-$DATE.tar.gz" | cut -f1)"

# Backup Coolify configs
log "Backing up Coolify configs..."
tar czf "$BACKUP_DIR/coolify-config-$DATE.tar.gz" \
    -C /data/coolify proxy/dynamic/ 2>/dev/null || log "WARN: Could not backup Coolify config"

# Backup databases (all PostgreSQL containers)
for CONTAINER in $(docker ps --filter "ancestor=postgres:17-alpine" --format '{{.Names}}' 2>/dev/null); do
    log "Dumping database from $CONTAINER..."
    docker exec "$CONTAINER" pg_dumpall -U postgres 2>/dev/null | gzip > "$BACKUP_DIR/db-$CONTAINER-$DATE.sql.gz" || log "WARN: Failed to dump $CONTAINER"
done

# Clean old backups (keep last 7 days)
log "Cleaning backups older than 7 days..."
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete 2>/dev/null
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete 2>/dev/null

log "Backup complete. Contents of $BACKUP_DIR:"
ls -lh "$BACKUP_DIR"/ 2>/dev/null
