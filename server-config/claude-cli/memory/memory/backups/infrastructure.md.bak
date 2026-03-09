

ContainerInventory (20 containers)

|Project | App Container | DB Container | Network | Port |
|---------|--------------|--------------|---------|------|
| Overlord | overlord | mastercommander-db (shared) | coolify | 127.0.0.1:3001 |
| SurfaBabe | surfababe | surfababe-db | coolify | 127.0.0.1:3002 |
| MasterCommander | mastercommander | mastercommander-db (shared) | coolify | 127.0.0.1:3010 |
| NamiBarden | namibarden | namibarden-db | standalone (docker-compose labels) | 80 internal |
| Lumina | lumina-app | lumina-db | okw0cwwgskcow8k8o08gsok0 (isolated) | 3456 internal |
| OnlyHulls | coolify | coolify-db + coolify-redis | coolify | 127.0.0.1:5433/7701/6380 |
| Elmo | coolify | None (static) | coolify | 80 internal |
| Coolify | coolify + coolify-realtime + coolify-sentinel + coolify-proxy | coolify-db (PG 15) + coolify-redis | coolify | 127.0.0.1:8000 / 0.0.0.0:80,443 |

Databases (all PG 17 except coolify-db PG 15)

| DB Container | Database(s) | Used by |
|-------------|-------------|---------|
| mastercommander-db | mastercommander | MasterCommander + Overlord auth endpoints |
| namibarden-db | namibarden | NamiBarden |
| surfababe-db | surfababe | SurfaBabe |
| lumina-db | lumina | Lumina |
| onlyhulls-db | onlyhulls | OnlyHulls |

Networks
- coolify — main network, most services
- okw0cwwgskcow8k8o08gsok0 — Lumina isolated (Traefik bridges HTTP)

Coolify UUIDs
- OnlyHulls: qkggs84cs88o0gww4wc80gwo
- Elmo: zkk0k8gcgcss4osggs4k0kw4
- Lumina: okw0cwwgskcow8k8o08gsok0

Notes
- NamiBarden NOT Coolify-managed — standalone docker-compose with Traefik labels
- OnlyHulls infra (db/meilisearch/redis) runs from infra/docker-compose.infra.yml on host
- Only coolify-proxy (Traefik) bound to 0.0.0.0 — everything else 127.0.0.1 or internal
