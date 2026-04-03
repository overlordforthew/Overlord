# Error Resolution Patterns

## Container Crashes
- **SIGTERM (code 143):** Out of memory. Check `docker stats` for memory usage. Reduce concurrent operations or increase memory limit.
- **SIGKILL (code 137):** Kernel OOM killer. More severe than 143. Same cause, more aggressive response needed.
- **Exit code 1 with no logs:** Usually a startup error before logging initializes. Run `docker logs <container> 2>&1 | head -20` to catch early errors.

## WhatsApp Disconnects
- **Reconnect loop (3+ attempts):** Usually network instability or WhatsApp server issues. If persists >5 min, force restart: `docker restart overlord`.
- **Auth failure after rebuild:** Auth state corrupted. Delete `auth/` and re-scan QR. Keep a backup of `auth/` before risky operations.

## Claude CLI Issues
- **Timeout after 10 min:** Complex task exceeded `maxResponseTime`. Check if the task is appropriate for CLI (vs breaking into smaller steps).
- **"Session not found":** Session was killed by session guard or expired. Auto-creates new session on next message.
- **Permission denied on tool use:** Claude CLI settings.json restricts tools. Check `/root/overlord/server-config/claude-cli/settings.json`.

## Database Issues
- **Connection refused to overlord-db:** Container not healthy yet. Check `docker ps` for health status. Wait for `(healthy)` marker.
- **WAL mode issues:** SQLite memory-v2.db uses WAL mode. If DB gets corrupted, the `-wal` and `-shm` files must be consistent. Never delete just one of them.

## Network / Traefik
- **502 Bad Gateway:** Backend container is down or not responding. Check container status first.
- **503 Service Unavailable:** Traefik can't route to the service. Check route config in `/data/coolify/proxy/dynamic/namibarden.yaml`.
- **SSL renewal failures:** Traefik handles Let's Encrypt auto-renewal. If failing, check Traefik logs: `docker logs coolify-proxy --tail 50`.

## Pattern: Diagnose Before Fix
1. Read the actual error message (don't guess)
2. Check logs: `docker logs <container> --tail 50`
3. Check resource state: `docker stats --no-stream`
4. Identify root cause (not symptom)
5. Fix the root cause
6. Verify the fix works
7. Write the pattern here if it's likely to recur
