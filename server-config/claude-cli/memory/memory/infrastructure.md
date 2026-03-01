# Infrastructure — Container & Database Map

Last audited: 2026-02-26

## Container Inventory (17 containers)

| Project | App Container | DB Container | PG Version | Network | Port |
|---------|--------------|--------------|------------|---------|------|
| **Overlord** | `overlord` | Uses BeastMode PG (`mastercommander` DB) | 17 | coolify | 127.0.0.1:3001 |
| **SurfaBabe** | `surfagent` | `surfagent-db` | 17 | coolify | 127.0.0.1:3002 |
| **BeastMode** | `ug80oocw84scswk084kcw0ok-*` (frontend) + `api-eoc8084s8gckk4skgsg08k08` (API) | `co88ksk4cks8s8o44o8gc8w8` (`beastmode-db`) | 17 | coolify | 3000 internal |
| **Lumina** | `app-okw0cwwgskcow8k8o08gsok0-*` | `db-okw0cwwgskcow8k8o08gsok0-*` | 17 | okw0cwwgskcow8k8o08gsok0 | 3456 internal |
| **ElSalvador** | `q0wcsgo0wccsgkows08gocks-*` | SQLite (no container) | N/A | coolify | 8000 internal |
| **MasterCommander** | `mastercommander` (nginx) | Uses BeastMode PG (`mastercommander` DB) | N/A | coolify | 127.0.0.1:3010 |
| **NamiBarden** | `ock0wowgsgwwww8w00400k00-*` | None (static) | N/A | coolify | 80 internal |
| **Elmo** | `zkk0k8gcgcss4osggs4k0kw4-*` | None (static) | N/A | coolify | 80 internal |
| **Coolify** | `coolify` + `coolify-realtime` + `coolify-sentinel` | `coolify-db` (PG 15) + `coolify-redis` (Redis 7) | 15 | coolify | 127.0.0.1:8000 |

## Shared Database: `co88ksk4cks8s8o44o8gc8w8` (beastmode-db)
- **PG 17**, standalone Coolify database on `coolify` network
- Hosts TWO databases: `postgres` (BeastMode tables) + `mastercommander` (MC auth: mc_users, boats)
- Volume: `postgres-data-co88ksk4cks8s8o44o8gc8w8`
- Compose: `/data/coolify/databases/co88ksk4cks8s8o44o8gc8w8/docker-compose.yml`
- Both BeastMode frontend + API connect to `postgres` DB
- Overlord connects to `mastercommander` DB for MC auth endpoints

## Volumes (6 active, all clean)
- `coolify-db` — Coolify internal
- `coolify-redis` — Coolify internal
- `elsalvador-data` — ElSalvador SQLite
- `okw0cwwgskcow8k8o08gsok0_lumina-pgdata` — Lumina PG data
- `postgres-data-co88ksk4cks8s8o44o8gc8w8` — BeastMode/MC PG data
- `surfababe_surfagent-pgdata` — SurfaBabe PG data

## Networks
- `coolify` — main network, all services except Lumina
- `eoc8084s8gckk4skgsg08k08` — BeastMode API private network
- `okw0cwwgskcow8k8o08gsok0` — Lumina isolated network (Traefik bridges HTTP)

## Coolify Config Paths
- **Applications:** `/data/coolify/applications/{uuid}/` (docker-compose.yaml + .env)
- **Databases:** `/data/coolify/databases/{uuid}/` (docker-compose.yml)
- **Services:** `/data/coolify/services/{uuid}/` (docker-compose.yml + .env)
- BeastMode frontend: `ug80oocw84scswk084kcw0ok`
- Lumina: `okw0cwwgskcow8k8o08gsok0`
- NamiBarden: `ock0wowgsgwwww8w00400k00`
- ElSalvador: `q0wcsgo0wccsgkows08gocks`
- BeastMode API service: `eoc8084s8gckk4skgsg08k08`
- BeastMode DB: `co88ksk4cks8s8o44o8gc8w8`

## Audit History
- **2026-02-26 (full audit):**
  - Upgraded SurfaBabe PG 16 → 17 (dump/restore, zero data loss)
  - Upgraded Lumina PG 16 → 17 (dump/restore, zero data loss)
  - Fixed SurfaBabe docker-compose.yml: container names matched `surfagent`/`surfagent-db` to running state
  - Replaced BeastMode JWT_SECRET placeholder with 48-byte random secret
  - Fixed Lumina `/var/www/lumina/.env` permissions 644 → 600
  - Fixed Overlord CLAUDE_MODEL env not propagating (removed dead AMADEUS env block, recreated)
  - Removed 4 orphan volumes (old Lumina + 3 OpenClaw), reclaimed ~229 MB
  - Pruned stale images, reclaimed ~2.1 GB
  - Removed stale Coolify configs (unused Lumina standalone DB + OpenClaw service)
  - All 17 containers healthy, all DBs PG 17, all HTTP 200
