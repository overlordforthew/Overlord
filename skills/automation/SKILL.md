# Skill: Automation & Scheduled Tasks

## Scope
Cron jobs, webhooks, scheduled tasks, and automated workflows on this server.

## Cron Jobs (gil's crontab)
```
0 */6 * * * /root/overlord/scripts/health-check.sh && /root/overlord/scripts/update-status.sh
0 0 * * *   /root/overlord/scripts/backup.sh
0 6 * * *   /root/overlord/scripts/morning-brief.sh
0 */6 * * * /usr/bin/claude auth status > /dev/null 2>&1
```

## Managing Cron
```bash
crontab -e                # Edit cron jobs
crontab -l                # List cron jobs
journalctl -u cron        # Check cron execution logs
```

## Common Automation Patterns

### Webhook Receivers
- Coolify handles GitHub webhook → auto-deploy
- Custom webhooks can be added via Express/FastAPI endpoints

### Scheduled Docker Tasks
```bash
# Run a one-off command in a container
docker exec <container> <command>

# Schedule via cron
0 3 * * * docker exec postgres pg_dump -U user db > /root/backups/db.sql
```

### File Watchers
- Traefik-watcher.sh monitors Docker events for container deploys
- Pattern: `docker events --filter "event=start" | while read ...`

### Health Monitoring
- scripts/health-check.sh runs every 6 hours
- Could add: alert via WhatsApp if something is down
- Pattern: check → detect issue → send WhatsApp message via Overlord API

## Creating New Automations
1. Write script in /root/overlord/scripts/
2. Make executable: `chmod +x script.sh`
3. Test manually first
4. Add to crontab with appropriate schedule
5. Document in this SKILL.md and CHANGELOG.md
