#!/bin/bash
# backup.sh — Backup critical files + sync server-config to git
# Stores in ~/backups/ with date stamps, keeps last 7 days

set -euo pipefail

BACKUP_DIR="/root/backups"
OVERLORD_DIR="/root/overlord"
DATE=$(date +%Y-%m-%d)
LOG_TAG="[backup]"

log() { echo "$LOG_TAG $(date -u '+%H:%M:%S') $*"; }

mkdir -p "$BACKUP_DIR"

# 1. Sync server-config/ into the repo (disaster recovery)
log "Syncing server configs to repo..."
mkdir -p "$OVERLORD_DIR/server-config/claude-cli"
cp /etc/fail2ban/jail.local "$OVERLORD_DIR/server-config/fail2ban-jail.local" 2>/dev/null || true
cp /etc/fail2ban/filter.d/traefik-botsearch.conf "$OVERLORD_DIR/server-config/fail2ban-traefik-botsearch.conf" 2>/dev/null || true
cp /etc/fail2ban/filter.d/traefik-ratelimit.conf "$OVERLORD_DIR/server-config/fail2ban-traefik-ratelimit.conf" 2>/dev/null || true
cp /etc/logrotate.d/traefik "$OVERLORD_DIR/server-config/logrotate-traefik" 2>/dev/null || true
cp /data/coolify/proxy/docker-compose.yml "$OVERLORD_DIR/server-config/traefik-docker-compose.yml" 2>/dev/null || true
cp /data/coolify/proxy/dynamic/namibarden.yaml "$OVERLORD_DIR/server-config/traefik-namibarden.yaml" 2>/dev/null || true
crontab -l > "$OVERLORD_DIR/server-config/crontab-root.txt" 2>/dev/null || true
cp -r /root/.claude/projects/-root/memory/ "$OVERLORD_DIR/server-config/claude-cli/memory/" 2>/dev/null || true
cp -r /root/.claude/skills/ "$OVERLORD_DIR/server-config/claude-cli/skills/" 2>/dev/null || true
cp /root/.claude/settings.json "$OVERLORD_DIR/server-config/claude-cli/settings.json" 2>/dev/null || true
cp /root/.claude/settings.local.json "$OVERLORD_DIR/server-config/claude-cli/settings.local.json" 2>/dev/null || true

# Auto-commit if anything changed
cd "$OVERLORD_DIR"
if ! git diff --quiet HEAD -- server-config/ data/; then
    git add server-config/ data/*/memory.md 2>/dev/null || true
    git commit -m "backup: sync server-config + chat memories ($(date '+%Y-%m-%d'))" --no-verify 2>/dev/null || true
    git push 2>/dev/null || true
    log "Pushed config changes to GitHub"
else
    log "No config changes to push"
fi

# 2. Backup Overlord workspace (excluding node_modules, auth, media, .git)
log "Backing up Overlord workspace..."
tar czf "$BACKUP_DIR/overlord-$DATE.tar.gz" \
    --exclude='node_modules' \
    --exclude='.git' \
    --exclude='media' \
    -C /root overlord/ 2>/dev/null
log "Overlord workspace: $(du -sh "$BACKUP_DIR/overlord-$DATE.tar.gz" | cut -f1)"

# 3. Backup Coolify configs
log "Backing up Coolify configs..."
tar czf "$BACKUP_DIR/coolify-config-$DATE.tar.gz" \
    -C /data/coolify proxy/dynamic/ 2>/dev/null || log "WARN: Could not backup Coolify config"

# 4. Backup databases (all PostgreSQL containers)
for CONTAINER in $(docker ps --filter "ancestor=postgres:17-alpine" --format '{{.Names}}' 2>/dev/null); do
    log "Dumping database from $CONTAINER..."
    PG_USER=$(docker inspect "$CONTAINER" --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^POSTGRES_USER=' | cut -d= -f2)
    PG_USER="${PG_USER:-postgres}"
    docker exec "$CONTAINER" pg_dumpall -U "$PG_USER" 2>/dev/null | gzip > "$BACKUP_DIR/db-$CONTAINER-$DATE.sql.gz" || log "WARN: Failed to dump $CONTAINER"
done

# 5. Clean old backups (keep last 7 days)
log "Cleaning backups older than 7 days..."
find "$BACKUP_DIR" -name "*.tar.gz" -mtime +7 -delete 2>/dev/null
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +7 -delete 2>/dev/null

log "Backup complete. Contents of $BACKUP_DIR:"
ls -lh "$BACKUP_DIR"/ 2>/dev/null
