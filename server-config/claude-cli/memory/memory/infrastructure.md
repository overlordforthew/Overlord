# Infrastructure — Container & Database Map

Last audited: 2026-03-01

## Container Inventory (20 containers)

| Project | App Container | DB Container | Network | Port |
|---------|--------------|--------------|---------|------|
| **Overlord** | `overlord` | `mastercommander-db` (shared) | coolify | 127.0.0.1:3001 |
| **SurfaBabe** | `surfababe` | `surfababe-db` | coolify | 127.0.0.1:3002 |
| **MasterCommander** | `mastercommander` (nginx) | `mastercommander-db` | coolify | 127.0.0.1:3010 |
| **NamiBarden** | `namibarden` | `namibarden-db` | standalone (docker-compose labels) | 80 internal |
| **Lumina** | `lumina-app` | `lumina-db` | okw0cwwgskcow8k8o08gsok0 (isolated) | 3456 internal |
| **OnlyHulls** | Coolify `qkggs84cs88o0gww4wc80gwo-*` | `onlyhulls-db` + `onlyhulls-meilisearch` + `onlyhulls-redis` | coolify | 127.0.0.1:5433/7701/6380 |
| **Elmo** | Coolify `zkk0k8gcgcss4osggs4k0kw4-*` | None (static) | coolify | 80 internal |
| **Coolify** | `coolify` + `coolify-realtime` + `coolify-sentinel` + `coolify-proxy` | `coolify-db` (PG 15) + `coolify-redis` | coolify | 127.0.0.1:8000 / 0.0.0.0:80,443 |

**Offline:** BeastMode (containers removed), ElSalvador (stopped)

## Databases (all PG 17 except coolify-db PG 15)

| DB Container | Database(s) | Used by |
|-------------|-------------|---------|
| `mastercommander-db` | `mastercommander` (users, boats, boat_logs, gate_users, gate_nda, contact_submissions, newsletter_subscribers) | MasterCommander + Overlord auth endpoints |
| `namibarden-db` | `namibarden` (nb_admin, nb_subscribers, nb_contacts, nb_campaigns, nb_campaign_recipients, nb_email_events) | NamiBarden |
| `surfababe-db` | `surfababe` (7 tables) | SurfaBabe |
| `onlyhulls-db` | `onlyhulls` (users, boats, boat_dna, boat_media, buyer_profiles, matches, introductions, dreamboard, ai_conversations) + pgvector | OnlyHulls |
| `lumina-db` | `lumina` | Lumina |

## Networks
- `coolify` — main network, most services
- `okw0cwwgskcow8k8o08gsok0` — Lumina isolated (Traefik bridges HTTP)

## Coolify UUIDs
- OnlyHulls: `qkggs84cs88o0gww4wc80gwo`
- Elmo: `zkk0k8gcgcss4osggs4k0kw4`
- Lumina: `okw0cwwgskcow8k8o08gsok0`

## Notes
- NamiBarden is NOT Coolify-managed — standalone docker-compose with Traefik labels
- OnlyHulls infra (db/meilisearch/redis) runs from `infra/docker-compose.infra.yml` on host
- Only `coolify-proxy` (Traefik) is bound to 0.0.0.0 — everything else is 127.0.0.1 or internal
