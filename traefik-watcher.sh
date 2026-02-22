#!/bin/bash
# traefik-watcher.sh — Auto-updates Traefik config when Coolify deploys a new namibarden container
# Solves: Coolify gives containers a new random suffix on each deploy, breaking the hardcoded
#          service URL in /traefik/dynamic/namibarden.yaml inside coolify-proxy.

APP_PREFIX="ock0wowgsgwwww8w00400k00"
PROXY_CONTAINER="coolify-proxy"
CONFIG_PATH="/traefik/dynamic/namibarden.yaml"

log() { echo "[traefik-watcher] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# On startup, do an immediate sync in case a deploy happened while we were down
sync_now() {
    CURRENT=$(docker ps --filter "name=${APP_PREFIX}" --format '{{.Names}}' 2>/dev/null | head -1)
    if [ -z "$CURRENT" ]; then
        log "WARN: No running namibarden container found"
        return 1
    fi
    # Check what's currently in the config
    CONFIGURED=$(docker exec "$PROXY_CONTAINER" grep -oP 'http://\K[^:]+(?=:80)' "$CONFIG_PATH" 2>/dev/null | head -1)
    if [ "$CURRENT" = "$CONFIGURED" ]; then
        log "Config already points to $CURRENT — no update needed"
        return 0
    fi
    log "Updating config: $CONFIGURED -> $CURRENT"
    docker exec "$PROXY_CONTAINER" sed -i "s|http://${APP_PREFIX}-[0-9]*:80|http://${CURRENT}:80|" "$CONFIG_PATH" 2>/dev/null
    if [ $? -eq 0 ]; then
        log "SUCCESS: Traefik config updated to $CURRENT"
    else
        log "ERROR: Failed to update Traefik config"
        return 1
    fi
}

log "Starting — watching for namibarden container deploys"
sync_now

# Watch for new container start events matching namibarden
docker events \
    --filter "event=start" \
    --filter "label=coolify.resourceName=namibarden" \
    --format '{{.Actor.Attributes.name}}' 2>/dev/null | while read -r CONTAINER_NAME; do
    log "New container detected: $CONTAINER_NAME"
    # Brief pause for container networking to initialize
    sleep 3
    sync_now
done
