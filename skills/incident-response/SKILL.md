---
name: incident-response
version: 1.0.0
description: "Structured incident response, severity classification, post-mortem templates, and self-healing escalation. Adapted from agency-agents Incident Response Commander."
---

# Incident Response

Structured incident management for Overlord's self-healing system. Turns container chaos into documented resolution with severity classification, timeline tracking, and post-mortem follow-through.

## Severity Matrix

| Level | Name | Criteria | Auto-Heal? | Notify Gil? |
|-------|------|----------|------------|-------------|
| SEV1 | Critical | Full service down, data loss risk, security breach | Try 3x, then escalate | Yes, immediately |
| SEV2 | Major | Degraded service, key feature broken for users | Try 5x auto-fix loop | Only if auto-fix fails |
| SEV3 | Moderate | Minor feature broken, workaround exists | Auto-fix silently | No |
| SEV4 | Low | Cosmetic issue, no user impact, tech debt | Log and batch-fix | No |

## Escalation Triggers (auto-upgrade severity)

- Impact spreads to second service -> upgrade one level
- No root cause after 15 min (SEV1) or 1 hour (SEV2) -> escalate
- Same incident recurs within 7 days -> upgrade one level
- Any data integrity concern -> immediate SEV1

## Self-Healing Response Flow

### Step 1: Detection
- Alert fires (cron health check, container restart, error spike)
- Classify severity using the matrix above
- Log incident start time and initial symptoms

### Step 2: Diagnosis
- Check container logs (log-analyzer.sh scan <container>)
- Check resource usage (docker stats, disk, memory)
- Check recent changes (git log, docker inspect for image age)
- Identify root cause hypothesis

### Step 3: Resolution
- Apply fix (restart, rebuild, config change, rollback)
- Verify fix via health check (not just "it looks fine")
- Monitor for 5 minutes post-fix to confirm stability

### Step 4: Documentation
- Log in /tmp/incidents/ with timestamp
- If SEV1/SEV2: generate post-mortem
- If recurring: create/update runbook in this skill

## Post-Mortem Template

```
# Post-Mortem: [Incident Title]

Date: YYYY-MM-DD
Severity: SEV[1-4]
Duration: [start] - [end] ([total])
Service: [container/project affected]
Auto-healed: Yes/No

## What Happened
[2-3 sentences: what broke, who was affected]

## Timeline
| Time (UTC) | Event |
|------------|-------|
| HH:MM | Alert fired / symptom detected |
| HH:MM | Root cause identified |
| HH:MM | Fix applied |
| HH:MM | Service verified healthy |

## Root Cause
[Technical explanation of the failure chain]

### Contributing Factors
1. Immediate cause: [direct trigger]
2. Underlying cause: [why trigger was possible]
3. Systemic cause: [what process/config gap allowed it]

## Fix Applied
[What was done to resolve]

## Prevention
| Action | Owner | Priority | Status |
|--------|-------|----------|--------|
| [preventive measure] | Overlord/Gil | P1/P2 | Not Started |

## Lessons
[What should change to prevent recurrence]
```

## Runbooks (Known Failure Modes)

### Container Restart Loop
```
1. docker logs <container> --tail 50
2. Check for OOM (code 137), missing env vars, port conflicts
3. If OOM: check memory limits, look for leaks
4. If env: verify .env file exists and is mounted
5. If port: check for conflicting containers on same port
6. Fix and restart, monitor 5 min
```

### SSL Certificate Expiry
```
1. security-scan.sh ssl <domain>
2. Check Traefik ACME config
3. Force renewal: docker exec coolify-proxy sh -c "rm /letsencrypt/acme.json" && restart
4. Verify with openssl s_client
```

### Database Connection Refused
```
1. docker ps | grep postgres (is it running?)
2. docker logs <db-container> --tail 20
3. Check max_connections vs active count
4. If crashed: docker restart, check data integrity
5. If connection exhaustion: identify leaking service
```

### Disk Space Critical
```
1. df -h / (how bad?)
2. docker system df (Docker's share)
3. docker system prune -f (safe cleanup)
4. docker builder prune -f (build cache)
5. Check /var/log for oversized logs
6. If still critical: identify largest containers/volumes
```

## Integration with Standing Orders

This skill implements:
- SELF-HEALING standing order (auto-repair without notifying Gil)
- ERROR FIX LOOP standing order (loop until fixed, max 5 attempts)
- Severity matrix determines when to break silence and escalate
