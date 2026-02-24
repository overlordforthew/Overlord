#!/bin/sh
# ===========================================================================
# watch.sh -- Keeps Traefik file-config in sync with Coolify container names
#
# Problem:  Coolify generates a new container name on every deploy (the
#           suffix after the prefix changes).  The Traefik file-based config
#           at /data/coolify/proxy/dynamic/namibarden.yaml hardcodes the
#           container name as the upstream service URL.  After a redeploy
#           the old name no longer resolves and Traefik returns 502.
#
# Solution: This script does two things:
#   1. Listens for Docker "start" events matching the app prefix and
#      immediately patches the config when a new container comes up.
#   2. Runs a periodic health check every 30 seconds as a safety net
#      in case an event is missed.
#
# The script writes directly to the bind-mounted Traefik dynamic config
# directory (/data/coolify/proxy/dynamic/) which Traefik watches for
# changes and reloads automatically.
# ===========================================================================

set -eu

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CONTAINER_PREFIX="ock0wowgsgwwww8w00400k00"
TRAEFIK_CONFIG="/data/coolify/proxy/dynamic/namibarden.yaml"
HEALTH_CHECK_INTERVAL=30
LOG_TAG="namibarden-watcher"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
log() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [$LOG_TAG] $*"
}

# ---------------------------------------------------------------------------
# update_config: patches the Traefik config if the container name changed
#
# Uses sed to find any occurrence of the prefix followed by a suffix
# and replaces it with the currently running container name.
# Writes to a temp file and does an atomic mv to avoid Traefik reading
# a partially written file.
# ---------------------------------------------------------------------------
update_config() {
    # Find the currently running namibarden container
    running=$(docker ps --filter "name=${CONTAINER_PREFIX}" --format '{{.Names}}' | head -n1)

    if [ -z "$running" ]; then
        log "WARN: No running container matching prefix ${CONTAINER_PREFIX}"
        return 1
    fi

    # Check what the config currently points to
    if [ ! -f "$TRAEFIK_CONFIG" ]; then
        log "ERROR: Config file not found at ${TRAEFIK_CONFIG}"
        return 1
    fi

    # Extract the current container name from the service URL line
    # Matches: http://ock0wowgsgwwww8w00400k00-ANYTHING:80
    configured=$(grep -o "http://${CONTAINER_PREFIX}-[^:]*" "$TRAEFIK_CONFIG" | sed 's|http://||' | head -n1)

    if [ -z "$configured" ]; then
        log "ERROR: Could not find ${CONTAINER_PREFIX} in config file"
        return 1
    fi

    if [ "$configured" = "$running" ]; then
        log "OK: Config already points to ${running}"
        return 0
    fi

    log "UPDATE: ${configured} -> ${running}"

    # Atomic update: write to temp file, then move into place
    tmp="${TRAEFIK_CONFIG}.tmp.$$"
    sed "s|${configured}|${running}|g" "$TRAEFIK_CONFIG" > "$tmp"
    mv "$tmp" "$TRAEFIK_CONFIG"

    # Verify
    verify=$(grep -o "http://${CONTAINER_PREFIX}-[^:]*" "$TRAEFIK_CONFIG" | sed 's|http://||' | head -n1)
    if [ "$verify" = "$running" ]; then
        log "VERIFIED: Config now points to ${running}"
    else
        log "ERROR: Verification failed, config shows ${verify}"
        return 1
    fi

    return 0
}

# ---------------------------------------------------------------------------
# health_check_loop: periodic fallback that runs every HEALTH_CHECK_INTERVAL
# seconds.  Catches cases where a Docker event was missed.
# ---------------------------------------------------------------------------
health_check_loop() {
    while true; do
        sleep "$HEALTH_CHECK_INTERVAL"
        update_config 2>&1 || true
    done
}

# ---------------------------------------------------------------------------
# event_loop: listens for Docker container start events matching our prefix
# ---------------------------------------------------------------------------
event_loop() {
    log "Listening for Docker container start events..."

    docker events \
        --filter "event=start" \
        --filter "type=container" \
        --format '{{.Actor.Attributes.name}}' \
    | while read -r name; do
        case "$name" in
            ${CONTAINER_PREFIX}-*)
                log "EVENT: Container started: ${name}"
                # Brief pause for container networking to initialize
                sleep 3
                update_config 2>&1 || true
                ;;
        esac
    done

    log "ERROR: Docker event stream ended unexpectedly"
    return 1
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
log "Starting (PID $$)"
log "  Prefix:     ${CONTAINER_PREFIX}"
log "  Config:     ${TRAEFIK_CONFIG}"
log "  Health interval: ${HEALTH_CHECK_INTERVAL}s"

# Immediate sync on startup
log "Running startup sync..."
update_config || true

# Start the health check loop in the background
health_check_loop &
HEALTH_PID=$!
log "Health check loop started (PID ${HEALTH_PID})"

# Run the event loop in the foreground.
# If it exits (docker events dies), the container's restart policy will
# restart everything.
event_loop

# If we get here, something went wrong
log "FATAL: Event loop exited. Cleaning up."
kill "$HEALTH_PID" 2>/dev/null || true
exit 1
