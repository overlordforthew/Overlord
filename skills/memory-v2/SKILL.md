# Memory v2

Persistent session memory for Claude Code. Automatically captures tool events, compresses them into observations, and injects relevant context at session start.

## CLI

All commands via: `node /root/overlord/skills/memory-v2/scripts/memory.mjs <command>`

Alias: `memory <command>` (use full path in Bash tool)

### Commands

```
memory init                              — Initialize database
memory search <query> [--project P]      — Search observations (FTS5)
memory detail <id>                       — Show full observation
memory store --type T --title "..."      — Store new observation
  Types: decision|bugfix|feature|refactor|discovery|config
  Options: --narrative "..." --facts '[...]' --concepts '[...]'
           --files-read '[...]' --files-modified '[...]'
           --outcome worked|failed|partial --project P
memory mark-compressed --through-id N    — Mark events as compressed
memory update <id> --field value         — Update observation fields
memory supersede <id> --reason "..."     — Mark as superseded
memory delete <id> --reason "..."        — Soft-delete (archive)
memory merge <id1> <id2>                 — Combine two observations
memory history <id>                      — Show mutation audit log
memory stats                             — Dashboard
memory sessions                          — List recent sessions
memory compress                          — Manual compression trigger
```

## Hooks

- **PostToolUse** (all tools): Captures tool events to SQLite
- **UserPromptSubmit**: Checks compression threshold, prompts extraction
- **SessionStart**: Injects relevant memory context

## Compression Flow

When prompted to compress (via systemMessage):
1. Read the formatted tool events in the system message
2. Extract 1-5 observations based on session context
3. Run `memory store` for each observation
4. Run `memory mark-compressed --through-id N`

## Database

SQLite at `/root/overlord/data/memory-v2.db` (WAL mode, auto-created on first use).
