---
name: Overlord Personality Fix
description: IDENTITY.md was never loaded into system prompts — fixed 2026-04-03. Group chat personality wipeout fixed. Patrol reports made useful.
type: project
---

## What was broken (pre 2026-04-03)

IDENTITY.md existed on disk but was never read by index.js. The admin system prompt had a one-paragraph paraphrase buried in a wall of operational rules. Power users in group chats got `"helpful, witty, concise"` — zero personality. Regular users got the same generic prompt.

## What was fixed

1. **IDENTITY.md loaded at startup** — parsed into `OVERLORD_IDENTITY` (full) and `OVERLORD_IDENTITY_SHORT` (regular users). Injected as the FIRST thing in every system prompt.
2. **Admin prompt restructured** — identity first (newline-separated), then behavioral rules, then technical context. Was previously `.join(' ')` wall of text, now `.join('\n')`.
3. **Group personality** — power users in groups now get full Overlord identity. Agent personalities (Ai Chan, Dex) are DMs only.
4. **Regular users** — get `OVERLORD_IDENTITY_SHORT` instead of generic prompt.
5. **Patrol reports** — thresholds lowered (git 7d, errors 3, disk 65%, memory 70%, proposals 1). Low-priority findings now show details. Added container health checks (exited/dead/unhealthy). Always sends report.

**Why:** Gil was frustrated that responses had no personality, no learning, no ambition. The bot was behaving like a generic assistant instead of Overlord.

**How to apply:** If personality issues resurface, check: (1) Is IDENTITY.md loading? Look for `[Identity] Loaded IDENTITY.md` in startup logs. (2) Is the system prompt using `OVERLORD_IDENTITY`? Check index.js around line 2470. (3) Are group chats using the right personality block?
