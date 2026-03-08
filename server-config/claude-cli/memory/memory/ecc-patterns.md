# Patterns from everything-claude-code (extracted 2026-03-07)

## /learn — Instinct Extraction (TO IMPLEMENT)
- After completing a task, extract reusable "instincts" (trigger + action + confidence)
- Store project-scoped in per-project dirs, promote to global when seen in 2+ projects
- Replaces manual gotchas.md updates
- Source: /tmp/everything-claude-code/.opencode/commands/learn.md

## Continuous Learning v2.1 Hooks (TO IMPLEMENT)
- Observation hooks on PreToolUse/PostToolUse capture every tool call + outcome
- Background agent clusters observations into instincts every 30 min
- Structure: ~/.claude/homunculus/{instincts/{personal,inherited},evolved/,projects/}

## Verification Loop (ADOPT)
- Structured build -> lint -> test -> security scan -> diff review
- Replace/supplement codex-review with faster structured verify.sh

## Security Additions (CHECK)
- Audit all res.status(5xx) responses for stack trace / schema leaks
- Verify all DB queries use parameterized format ($1, $2)
- CSRF tokens on state-changing POST/PUT/DELETE (NamiBarden admin)

## Backend Patterns (FOR NAMIBARDEN/MC)
- Service layer: separate business logic from routes (services/stripe.ts, etc)
- Middleware composition: withAuth(handler) instead of inline checks
- N+1 prevention: batch fetches in admin queries
