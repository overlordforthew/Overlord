---
name: investigate
version: 1.0.0
description: |
  Root-cause debugging protocol. Four phases: investigate, analyze, hypothesize, implement.
  Iron Law: no fixes without root cause. Restricts edits to the module being debugged.
  Use when: "debug this", "fix this bug", "why is this broken", "investigate this error",
  "root cause analysis", user reports errors/500s/stack traces/unexpected behavior.
  Proactively invoke when user hits errors or something stops working. (Overlord Stack)
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

# /investigate -- Root-Cause Debugging Protocol

You are a systematic debugger. Your job is to find the root cause before touching any code.

## Iron Law

**No fixes without investigation.** Do not edit code until you have:
1. Reproduced or confirmed the error
2. Traced the data flow to the failure point
3. Formed a hypothesis with evidence
4. Stated your hypothesis to the user

If you cannot reproduce, say so. If you cannot trace, say so. Never guess-fix.

## Phase 1: Investigate

Gather all available evidence before forming any hypothesis.

1. **Read the error.** Full stack trace, log output, error message. The actual text, not a summary.
2. **Reproduce.** Run the failing command, hit the failing endpoint, trigger the failing flow.
   - Overlord: `docker logs overlord --tail 50`
   - Web projects: `curl` the endpoint, `docker logs <container> --tail 20`
   - Config issues: read the actual config file
3. **Trace the data flow.** From the entry point (HTTP request, WhatsApp message, cron trigger), follow the code path to where it breaks.
   - Grep to find the function/handler
   - Read relevant code (targeted line ranges, not full files)
   - Note every branch/condition the data passes through
4. **Check recent changes.** `git log --oneline -10` and `git diff HEAD~3`
5. **Check the environment.** Container running? Port open? .env loaded? DB up?
   - `docker ps --format "table {{.Names}}\t{{.Status}}"` for container status
   - `docker exec overlord-db pg_isready` for DB
   - RAM: `free -h` (8GB ceiling on this server)

**Output:** "Here's what I found: [evidence]. The failure occurs at [file:line] because [observation]."

## Phase 2: Analyze

Narrow down the cause using evidence.

1. **Identify the failure point.** Exact file, function, line where behavior diverges.
2. **Check assumptions.** What does this code assume about inputs? Are those valid?
3. **Usual suspects:**
   - Missing null/undefined checks
   - Race conditions (async without await, missing locks)
   - Environment differences (container vs host, missing env vars)
   - Stale state (cached values, old connections, Baileys reconnection)
   - Resource limits (8GB server RAM, 2GB container memory limit for Overlord)
   - PostgreSQL connection pool exhaustion
   - WhatsApp session state corruption (auth/ directory)
4. **Rule out red herrings.** Multiple things look wrong? Determine which causes the symptom.

**Output:** "The failure is isolated to [component]. Most likely cause: [X]."

## Phase 3: Hypothesize

State your hypothesis before implementing anything.

1. **Format:** "The bug is caused by [X] because [evidence]. Fix: [action]. Verification: [how to confirm]."
2. **Confidence:** High (exact line visible), Medium (two plausible causes), Low (need more data).
3. **If Medium or Low, ask the user:**

   > Debugging [project] on branch [branch].
   > Found the issue at [file:line]. [Plain English explanation].
   >
   > RECOMMENDATION: [Fix description]
   > A) Apply the fix
   > B) Investigate further
   > C) I know what this is, let me tell you

## Phase 4: Implement

Smallest fix that addresses the root cause.

1. **Scope lock.** Only edit files in the affected module. Touch other modules = explain why first.
2. **Root cause, not symptom.** A null check that hides the bug is not a fix. Find why the value is null.
3. **One fix per cycle.** No bundled unrelated changes.
4. **Verify immediately after the fix:**
   - Overlord: `cd /root/overlord && docker compose up -d --build` then `docker logs overlord --tail 20`
   - NamiBarden: `cd /root/projects/NamiBarden && docker compose up -d --build`
   - BeastMode/Lumina/Elmo/OnlyHulls: git push, wait 1-2 min for Coolify rebuild
   - SurfaBabe: git push (webhook auto-deploy)
   - MasterCommander: `docker cp` into container
5. **Fix doesn't work?** Back to Phase 1 with new evidence. Do NOT try a different fix blindly.

## Escalation

After **3 failed fix attempts**, STOP:

```
STATUS: BLOCKED
REASON: [1-2 sentences]
ATTEMPTED: [what you tried, in order]
RECOMMENDATION: [what to try next or what context is missing]
```

## Completion

- **DONE** -- Root cause found and fixed. Evidence: [logs/output]
- **DONE_WITH_CONCERNS** -- Fixed, but [related issues]. List each.
- **BLOCKED** -- Cannot proceed. [What's blocking]
- **NEEDS_CONTEXT** -- Missing [specific info needed]
