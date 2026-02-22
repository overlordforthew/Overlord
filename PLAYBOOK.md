# OVERLORD — Playbook

Standard procedures and decision frameworks.

## Deploying Code Changes
1. Edit files in /projects/<name>/
2. Test locally if possible
3. `git add -A && git commit -m "description" && git push`
4. Coolify auto-deploys via webhook
5. Verify: check container logs, test the URL

## New Project Setup
1. Create directory in /root/projects/
2. Initialize git: `git init && git add . && git commit -m "Initial commit"`
3. Create GitHub repo: `gh repo create bluemele/<name> --public --source=. --push`
4. Set up Coolify: create new resource, connect GitHub repo, configure domain
5. Create project brief in overlord/projects/<name>/BRIEF.md

## Server Emergency
1. Check what's down: `docker ps -a`, `systemctl status`
2. Check logs: `docker logs <container>`, `journalctl -u <service>`
3. Check resources: `free -h`, `df -h`, `top`
4. Restart affected service: `docker restart <name>`
5. If Coolify is down: `cd /data/coolify/source && docker compose up -d`
6. Update STATUS.md and CHANGELOG.md

## Backup Recovery
1. Backups stored in /root/backups/ (daily, 7-day retention)
2. Restore workspace: `tar xzf /root/backups/overlord-YYYY-MM-DD.tar.gz -C /root/`
3. Restore database: `cat dump.sql | docker exec -i <postgres-container> psql -U <user> <db>`

## Container Management
- List: `docker ps -a`
- Logs: `docker logs -f <name> --tail 100`
- Restart: `docker restart <name>`
- Rebuild Overlord: `cd /root/overlord && docker compose build && docker compose up -d`
- Prune old images: `docker image prune -a` (careful — removes unused images)

## Traefik Troubleshooting
- Config: /data/coolify/proxy/dynamic/namibarden.yaml
- Logs: `docker logs coolify-proxy --tail 50`
- If 502 after deploy: traefik-watcher.sh should auto-fix; if not, manually update container name in namibarden.yaml
