---
name: ship-it
version: 1.0.0
description: |
  Multi-project deploy skill. Knows every project's deploy method: Coolify auto-deploy,
  manual docker compose, docker cp, webhook. Handles git push, rebuild, verify.
  Use when: "ship it", "deploy", "push and deploy", "get this live", "send it".
  Proactively invoke when user says code is ready or asks to deploy. (Overlord Stack)
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# /ship-it -- Multi-Project Deploy

You are a release engineer who knows every project's deploy method on this server.

## Step 0: Detect Project

Determine which project we're shipping based on the current working directory.

```bash
pwd
git remote get-url origin 2>/dev/null || echo "no remote"
git branch --show-current 2>/dev/null || echo "detached"
git status --short
```

Match the directory to a project:

| Project | Path | Deploy Method |
|---------|------|---------------|
| Overlord | `/root/overlord/` | `docker compose up -d --build` |
| NamiBarden | `/root/projects/NamiBarden/` | `docker compose up -d --build` |
| MasterCommander | `/root/projects/MasterCommander/` | `docker cp` into container |
| BeastMode | `/root/projects/BeastMode/` | Coolify auto-deploy on push |
| Lumina | `/root/projects/Lumina/` | Coolify auto-deploy on push |
| SurfaBabe | `/root/projects/SurfaBabe/` | Webhook auto-deploy on push (or manual compose) |
| Elmo | `/root/projects/Elmo/` | Coolify auto-deploy on push |
| OnlyHulls | `/root/projects/OnlyHulls/` | Coolify auto-deploy on push |
| ElSalvador | `/root/projects/ElSalvador/` | OFFLINE - do not deploy |

If ElSalvador, STOP: "This project is offline. To restore, start the container in Coolify first."

If unknown directory, ask the user which project this is.

## Step 1: Pre-flight Checks

Before shipping anything:

1. **Uncommitted changes?** `git status --short` -- if dirty, ask what to commit.
2. **On the right branch?** Confirm we're on the branch the user intends to ship.
3. **Tests pass?** If a test command exists in package.json or CLAUDE.md, run it.
4. **No secrets in diff?** Scan staged changes for patterns:
   - API keys, tokens, passwords in string literals
   - .env files being committed
   - Private keys or certificates

```bash
git diff --cached --name-only | head -20
git diff --cached -S "API_KEY\|SECRET\|PASSWORD\|PRIVATE_KEY\|TOKEN=" --name-only 2>/dev/null || true
```

If secrets found, STOP and warn. Do not proceed.

## Step 1.5: Cross-Model Review (Major Rollouts)

For significant changes (3+ files or core module changes), run cross-model adversarial review before pushing:

Run `/crossreview` on the staged diff. This sends the changes to non-Claude models for independent review, catching blind spots before code goes live.

- If crossreview finds BLIND SPOT CATCHES or CONSENSUS issues at BUG/SECURITY severity: **pause and show findings to the user before proceeding to push**
- If crossreview returns CLEAN or only has CONFLICTS/noise: proceed to Step 2
- If all external models are unavailable (rate limited): note this in the deploy report and proceed -- don't block the deploy on free model availability

Skip this step for:
- Single-file config changes
- Documentation-only changes
- Emergency hotfixes (user says "hotfix" or "urgent")

## Step 2: Git Push

Set up auth and push:

```bash
# Load GH_TOKEN for push auth
source /root/overlord/.env 2>/dev/null
REPO_URL=$(git remote get-url origin)
# Set authenticated remote if needed
if ! echo "$REPO_URL" | grep -q "bluemele:"; then
  REPO_NAME=$(basename "$REPO_URL" .git)
  git remote set-url origin "https://bluemele:${GH_TOKEN}@github.com/bluemele/${REPO_NAME}.git"
fi
git push origin HEAD
```

## Step 3: Deploy (project-specific)

### Overlord
```bash
cd /root/overlord && docker compose up -d --build
```
Wait 5 seconds, then check logs.

### NamiBarden
```bash
cd /root/projects/NamiBarden && docker compose up -d --build
```

### MasterCommander
```bash
# Copy changed files into running container
docker cp /root/projects/MasterCommander/. mastercommander:/app/
# Restart if needed
docker restart mastercommander
```

### Coolify Auto-Deploy (BeastMode, Lumina, Elmo, OnlyHulls)
Git push triggers Coolify webhook. Wait 1-2 minutes for rebuild.
```bash
echo "Coolify auto-deploy triggered. Waiting 90 seconds for rebuild..."
sleep 90
```

### SurfaBabe
Git push triggers webhook on port 9002. Or manual:
```bash
cd /root/projects/SurfaBabe && docker compose up -d --build
```

## Step 4: Verify

Every deploy gets verified. No exceptions.

```bash
# Container running?
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep -i "<PROJECT>"

# Recent logs clean?
docker logs <CONTAINER> --tail 15 2>&1
```

For web projects, also check the endpoint:
```bash
curl -sI https://<DOMAIN> | head -5
```

Project domains:
- namibarden.com
- beastmode.namibarden.com
- lumina.namibarden.com
- surfababe.namibarden.com
- mastercommander.namibarden.com
- onlydrafting.com (Elmo)
- onlyhulls.com

## Step 5: Report

```
STATUS: DONE
PROJECT: [name]
BRANCH: [branch] -> [remote]
DEPLOY: [method used]
VERIFY: [container status + endpoint check result]
```

Or if something went wrong:
```
STATUS: DONE_WITH_CONCERNS
ISSUE: [what happened]
LOGS: [relevant log lines]
RECOMMENDATION: [what to check or fix]
```

## Codex Review (Overlord only)

For Overlord commits, run codex review after deploy:
```bash
bash /root/overlord/scripts/codex-review.sh
```
