# Skill: Session Briefing

## Scope
Pre-computes and injects a situational briefing when Claude Code sessions start.
Gives Overlord personality, server awareness, git activity, repair history, and memory context.

## Architecture

### Pre-compute (cron every 30min)
`build-session-briefing.mjs` gathers data from multiple sources and writes
`/root/overlord/data/session-briefing.json`. Keeps the SessionStart hook fast (~3ms read).

### SessionStart Hook
`inject-context.mjs` reads the pre-computed JSON, formats it into a system message
with Overlord personality directives, and outputs `{ systemMessage: string }`.
Falls back to inline `buildSessionContext()` if the briefing is stale (>2h).

## Data Sources
- **STATUS.md** — uptime, memory, disk, container list (pre-computed by update-status.sh)
- **heartbeat.json** — per-service health status (pre-computed by health-check.sh)
- **Git logs** — last 48h commits across all project repos (3 per project, 10 max total)
- **task-events.jsonl** — recent auto-repair events
- **observations (SQLite)** — memory-v2 observations for project context
- **Time context** — day, date, time in AST, waking hours detection

## Scripts

### build-session-briefing.mjs
Gathers all data sources and writes `session-briefing.json`.
```bash
cd /root/overlord && node scripts/build-session-briefing.mjs
```

### build-session-briefing.sh
Thin cron wrapper — runs the Node script and writes a heartbeat.
```bash
bash /root/overlord/scripts/build-session-briefing.sh
```

### inject-context.mjs (in memory-v2/scripts/)
The SessionStart hook. Reads pre-computed briefing, formats system message.
```bash
echo '{}' | node /root/overlord/skills/memory-v2/scripts/inject-context.mjs
```

## Token Budget
~1500 tokens max for the data portion:
- 3 commits per project, 10 total
- 5 task events max
- 5 memory observations + 3 cross-project patterns
- Empty sections are skipped entirely

## Cron
```
*/30 * * * * bash /root/overlord/scripts/build-session-briefing.sh >> /root/overlord/logs/session-briefing.log 2>&1
```

## Output Format
The system message follows this template:
```
OVERLORD — SESSION BRIEFING
[personality directives + greeting instruction]

SERVER: [one-liner — uptime, RAM, disk, containers]
ISSUES: [only if any]

ACTIVITY (last 48h):
  [per-project commit summaries]

AUTO-REPAIRS (N in 48h): [only if any]

CURRENT PROJECT (name): [only if project detected]

MEMORY: N active observations
TIME: Day, date time AST
```

## Effectiveness Analysis

Every injection is logged to `data/briefing-injections.jsonl` with section metadata.
The analysis script cross-references these with session transcripts to measure what
briefing content actually influenced the session.

### analyze-effectiveness.mjs
```bash
# Human-readable report
node /root/overlord/skills/session-briefing/analyze-effectiveness.mjs

# All sessions (not just last 20)
node /root/overlord/skills/session-briefing/analyze-effectiveness.mjs --all

# Machine-readable JSON
node /root/overlord/skills/session-briefing/analyze-effectiveness.mjs --json
```

### What it measures per session
- **greeting_delivered**: Did the first response use briefing context?
- **server_referenced**: Was server health mentioned during the session?
- **issues_acted_on**: Were flagged issues (stopped containers, etc.) addressed?
- **git_referenced**: Were recent commits or their projects discussed/worked on?
- **repairs_referenced**: Were auto-repair events discussed?
- **memory_used**: Was the memory system queried?
- **projects_worked**: Which projects were touched (from tool file paths)

### Optimization loop
1. Collect ~10+ sessions of data
2. Run `analyze-effectiveness.mjs` to see usage rates
3. Sections with <20% usage → candidates for trimming or moving to on-demand
4. Sections with >50% usage → keep, possibly expand
5. Adjust `build-session-briefing.mjs` and `formatBriefing()` accordingly

### Data files
- `data/briefing-injections.jsonl` — one line per session start (what was injected)
- `data/session-briefing.json` — the pre-computed briefing (refreshed every 30min)

## Tuning & Improvement
- Adjust `MAX_AGE_MS` in inject-context.mjs to change staleness threshold (default: 2h)
- Add new data sources to `build-session-briefing.mjs` (keep within token budget)
- Modify the greeting personality in `formatBriefing()` in inject-context.mjs
- The system message template can be refined — personality lives in IDENTITY.md, referenced not duplicated

## When to Use
- Automatically: runs on every Claude Code session start via SessionStart hook
- Manually: `node scripts/build-session-briefing.mjs` to refresh the briefing
- Debug: `echo '{}' | node skills/memory-v2/scripts/inject-context.mjs` to see formatted output
- Analysis: `node skills/session-briefing/analyze-effectiveness.mjs` after 5+ sessions
