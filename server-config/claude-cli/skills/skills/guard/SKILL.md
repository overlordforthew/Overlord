---
name: guard
version: 1.0.0
description: |
  Safety guardrails for destructive commands. Intercepts rm -rf, DROP TABLE,
  force-push, git reset --hard, docker prune, kill -9, and similar before execution.
  User can override each warning. Use when touching prod, debugging live systems,
  or working in shared environments. Use when: "be careful", "safety mode",
  "guard mode", "careful mode", "prod mode". (Overlord Stack)
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
hooks:
  PreToolUse:
    - matcher: "Bash"
      hooks:
        - type: command
          command: "bash ${CLAUDE_SKILL_DIR}/bin/check-guard.sh"
          statusMessage: "Checking for destructive commands..."
---

# /guard -- Destructive Command Protection

Safety mode is now **active**. Every bash command will be checked for destructive
patterns before execution. If a destructive command is detected, you'll see a
warning and must confirm with the user before proceeding.

## Protected Patterns

| Pattern | Example | Risk |
|---------|---------|------|
| `rm -rf` / `rm -r` | `rm -rf /var/data` | Recursive delete |
| `DROP TABLE` / `DROP DATABASE` | `DROP TABLE users;` | Data loss |
| `TRUNCATE` | `TRUNCATE orders;` | Data loss |
| `git push --force` / `-f` | `git push -f origin main` | History rewrite |
| `git reset --hard` | `git reset --hard HEAD~3` | Uncommitted work loss |
| `git checkout .` / `git restore .` | `git checkout .` | Uncommitted work loss |
| `git clean -f` | `git clean -fd` | Untracked file deletion |
| `git branch -D` | `git branch -D feature` | Branch deletion |
| `docker system prune` | `docker system prune -a` | Container/image loss |
| `docker rm -f` | `docker rm -f overlord` | Container killed |
| `docker volume rm` | `docker volume rm data` | Volume data loss |
| `kill -9` / `pkill -9` | `kill -9 1234` | Process force-kill |
| `systemctl stop` | `systemctl stop nginx` | Service interruption |
| `reboot` / `shutdown` | `reboot now` | Server downtime |

## Safe Exceptions

These are allowed without warning:
- `rm -rf node_modules`, `dist`, `build`, `.next`, `/tmp/`, `__pycache__`
- `docker system prune --filter` (filtered prune)
- `git checkout -b` (branch creation, not discard)

## How It Works

The guard hook runs as a PreToolUse interceptor on every Bash call. If a
destructive pattern is found, the command is blocked and you must ask the user
for explicit confirmation before retrying.

When blocked, present the situation clearly:
> I need to run `[command]` which is a destructive operation ([risk]).
> Want me to proceed?

## Disabling

Say "guard off" or "disable guard" to deactivate. The hook only runs while
this skill is active in the session.

## Server Context

This server (Hetzner CX33, 8GB RAM) runs all production services:
- Overlord (WhatsApp bot) + overlord-db (PostgreSQL)
- Traefik reverse proxy
- 6+ Coolify-managed containers
- fail2ban with 4 active jails

Destructive commands here can take down real services. The guard exists because
mistakes on this box are not theoretical.
