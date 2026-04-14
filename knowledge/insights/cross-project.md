# Cross-Project Patterns

## Shared Infrastructure
All projects share: Hetzner CX33 server, Traefik reverse proxy, Coolify deployment platform, Cloudflare DNS.
**Implication:** A Traefik misconfiguration or disk pressure affects ALL projects simultaneously. Always check system-wide when one project has network issues.

## Common Deploy Failures
Pattern seen across BeastMode, Lumina, Elmo:
- Coolify auto-deploy fails silently when the build cache is stale
- Symptoms: git push succeeds but site shows old code
- Fix: manual rebuild in Coolify UI or `docker image prune` then re-push
- **Prevention:** Check Coolify dashboard after deploys, not just git push success

## Node.js Patterns (shared across Overlord, NamiBarden, Lumina, SurfaBabe, Elmo)
- All use ESM (`"type": "module"`)
- All use Express for HTTP
- Common mistake: importing CommonJS modules without `createRequire`
- Shared pattern: health endpoint at `/health` for monitoring

## Nginx Patterns (NamiBarden, MasterCommander)
- Static sites behind nginx in Docker
- Common issue: browser caching serves stale content after deploy
- Fix: version query strings on assets (`style.css?v=20260403`)
- HTML is served `no-cache` so structure updates are instant; only assets cache

## Database Patterns (Overlord, NamiBarden, Lumina)
- All use PostgreSQL 17
- All use connection pooling via `pg` module
- Common issue: connection refused after container rebuild (DB container needs health check)
- Pattern: `depends_on: condition: service_healthy` in docker-compose.yml
