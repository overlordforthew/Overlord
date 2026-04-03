# Docker & Deploy Patterns

## Container Memory Limits
- Overlord container has 4GB memory limit. Heavy tasks (multi-file Claude CLI sessions, large npm installs) can trigger SIGTERM/code 143.
- **Fix:** Break heavy tasks into sequential operations. Use work-queue.js for memory-isolated execution (simple: 512MB, medium: 768MB, complex: 1.2GB).
- Node.js default heap is ~1.5GB. For memory-intensive scripts, set `--max-old-space-size=2048`.

## Deploy Methods by Project
- **Auto-deploy (Coolify):** BeastMode, Lumina, Elmo, OnlyHulls — git push triggers rebuild (1-2 min).
- **Webhook deploy:** SurfaBabe — GitHub webhook → deploy-listener.js on port 9002.
- **Manual docker compose:** Overlord, NamiBarden — `docker compose up -d --build`.
- **Manual docker cp:** MasterCommander — files copied into running container.

## Container Restart Patterns
- After `docker compose up -d --build`, the container restarts and WhatsApp needs to reconnect. Baileys handles this with auto-retry, but messages during reconnect window (~5-10s) may be lost.
- If WhatsApp fails to reconnect after rebuild: check `auth/` directory integrity. MAC errors mean session corruption — delete `auth/` and re-link via QR.

## Common Docker Issues
- **Port conflicts:** All app containers bind to 127.0.0.1 only. Traefik handles external routing. If a container fails to start, check `docker ps` for port conflicts.
- **Coolify build cache:** Stale builds can cause Coolify deploys to use old code. Fix: trigger a manual rebuild in Coolify UI or clear build cache.
- **Database containers:** PostgreSQL containers (overlord-db, namibarden-db) must be healthy before app containers start. Docker compose `depends_on: condition: service_healthy` handles this.

## Post-Deploy Verification
1. `docker ps` — container running, correct image hash
2. `docker logs <container> --tail 20` — no crash loops, clean startup
3. `curl -s http://localhost:<port>/health` — health endpoint responds
4. For web projects: `curl -sI https://<domain>` — 200 OK, correct headers
