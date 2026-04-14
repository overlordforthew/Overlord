# Skill: beszel

## Description
Lightweight server monitoring dashboard using henrygd/beszel Docker container. Tracks container stats, system resources, and sends alerts. Only 30MB RAM footprint. Provides a web dashboard for Docker container health monitoring and exposes an API on port 8090.

## Type
Service (Docker container)

## Configuration
- Image: `henrygd/beszel`
- Port: 8090 (web dashboard + API)
- Network: `coolify` (for Traefik integration)
- Memory: ~30MB RAM
- Container name: `beszel`

```yaml
# docker-compose.yml
services:
  beszel:
    image: henrygd/beszel
    container_name: beszel
    restart: unless-stopped
    ports:
      - "8090:8090"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - beszel_data:/beszel_data
    networks:
      - coolify

volumes:
  beszel_data:

networks:
  coolify:
    external: true
```

## Usage
```bash
# Start the service
docker compose up -d

# Access dashboard
# http://localhost:8090

# API: get system stats
curl http://localhost:8090/api/v1/system

# API: get container stats
curl http://localhost:8090/api/v1/containers

# API: get alerts
curl http://localhost:8090/api/v1/alerts
```

## When to Use
- Monitoring Docker container health and resource usage
- Setting up alerts for container failures or resource spikes
- Quick system overview without heavy monitoring stacks (Prometheus/Grafana)
- Lightweight alternative when 30MB RAM budget matters
- Dashboard for Gil to check server health at a glance

## Requirements
- Docker with access to `/var/run/docker.sock`
- Port 8090 available
- No GPU, no external dependencies
- ~30MB RAM
