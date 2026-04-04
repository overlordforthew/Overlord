---
name: Ai-Chan Status
description: Current state of Ai-Chan (Nami's agent). DMs work fine, group personality was broken and fixed 2026-04-03.
type: project
---

## Current state (2026-04-03)
- **DMs:** Working well. Japanese responses, warm personality, Opus model, full project access (NamiBarden, Lumina). Last verified: March 31 conversations in DB show quality meditation script creation.
- **Groups:** Was broken — personality stripped to "helpful, witty, concise." Fixed: now gets full Overlord identity in groups (Ai Chan personality is DMs only).
- **Claude Code agent:** `/root/.claude/agents/ai-chan.md` — properly configured with memory at `/root/.claude/agent-memory/ai-chan/`. MEMORY.md has Nami's full profile, preferences, and project context.
- **Phone:** 84393251371 (Nami)
- **Profile in index.js:** Line ~387. Includes full personality, Stripe access, YouTube CLI access, Docker inspect for her containers.

## What to watch
- If Nami reports Ai Chan "not working" — check whether it's DM or group context first
- DM issues: check session ID, Claude CLI process, personality injection
- Group issues: verify `OVERLORD_IDENTITY` is being used (not generic prompt)
