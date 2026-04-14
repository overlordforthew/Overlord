# Skill: Server Administration

## Scope
Docker container management, Coolify deployments, firewall, Tailscale, backups, security, and system health for this Hetzner CX33 server.

## Server Specs
- 4 vCPU AMD EPYC-Rome | 8GB RAM | 80GB SSD | Ubuntu 24.04
- Tailscale IP: 100.83.80.116 | Hostname: overlord

## Docker Commands
```bash
docker ps -a                          # All containers
docker logs -f <name> --tail 100      # Follow logs
docker restart <name>                 # Restart container
docker stop <name> && docker start <name>
docker exec -it <name> sh             # Shell into container
docker stats --no-stream              # Resource usage snapshot
docker system df                      # Disk usage
docker image prune -a                 # Clean unused images (careful!)
```

## Key Containers
| Name | Service | Port |
|------|---------|------|
| coolify-proxy | Traefik v3.6 | 80, 443 |
| coolify | Dashboard | 127.0.0.1:8000 |
| overlord | WhatsApp bot | - |
| ock0wowgsgwwww8w00400k00-* | NamiBarden | 80 |
| q0wcsgo0wccsgkows08gocks-* | ElSalvador | 8000 |

## Coolify Management
- Dashboard: coolify.namibarden.com (Tailscale-only)
- Config: /data/coolify/source/docker-compose.yml
- App configs: /data/coolify/applications/<app-id>/
- Restart Coolify: `cd /data/coolify/source && docker compose up -d`

## Traefik Config
- Source of truth: /data/coolify/proxy/dynamic/namibarden.yaml
- DO NOT edit coolify.yaml (auto-generated, routes removed)
- Tailscale middleware: ipAllowList 100.64.0.0/10

## Firewall (UFW)
```bash
ufw status verbose                    # Current rules
ufw allow 80/tcp                      # Open HTTP
ufw allow 443/tcp                     # Open HTTPS
ufw deny from <ip>                    # Block IP
```
Current: 80/443 public, SSH from 10.0.0.0/8 + 172.16.0.0/12, Tailscale interface allowed.

## Tailscale
```bash
tailscale status                      # Connected devices
tailscale ip -4                       # Our IP
tailscale ping <hostname>             # Test connectivity
```

## System Health
```bash
free -h                               # Memory
df -h                                 # Disk
top -bn1 | head -20                   # CPU/processes
uptime                                # Load average
journalctl -u <service> --since "1h ago"  # Recent logs
```

## Database Access
```bash
# Connect to a Coolify-managed PostgreSQL
docker exec -it <postgres-container> psql -U postgres
# Dump a database
docker exec <postgres-container> pg_dump -U <user> <db> > dump.sql
```

## Emergency Procedures
1. Server unresponsive: Hetzner console (cloud.hetzner.com)
2. Coolify down: `cd /data/coolify/source && docker compose up -d`
3. Out of disk: `docker system prune -a` then `journalctl --vacuum-size=50M`
4. Out of RAM: check `docker stats`, stop non-essential containers
5. SSL cert expired: Traefik auto-renews; if stuck, restart coolify-proxy
