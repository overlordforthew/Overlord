---
name: memorydatabase
description: Interact with Overlord's memory database (SQLite). Use when user says "memorydatabase", "mem db", "memory database", or wants to search/manage/inspect the persistent memory system.
argument-hint: <command> [args] — Commands: status, search <query>, consolidate, briefing, standing-orders, recent, trending, recall <category>, save <category/topic> "content", forget <id>
allowed-tools:
  - Bash
  - Read
---

# Memory Database Skill

Overlord's persistent memory lives in a SQLite database (`/root/overlord/data/memory-v2.db`). This skill provides direct access to search, inspect, maintain, and manage it.

## Commands

Parse the user's argument to determine which command to run. If no argument, default to `status`.

### `status` (default)
Show memory health dashboard.
```bash
docker exec overlord node /app/scripts/mem.mjs stats
```

### `search <query>`
Full-text search across all memory types (semantic, episodic, procedural).
```bash
docker exec overlord node /app/scripts/mem.mjs search "<query>"
```

### `recall <category>`
Browse memories by category. Valid categories: `tool`, `project`, `infrastructure`, `security`, `preference`, `person`, `pattern`, `integration`.
```bash
docker exec overlord node /app/scripts/mem.mjs recall <category>
```

### `consolidate`
Run the full maintenance cycle: dedup duplicates, decay old memories, boost frequently accessed ones, prune dead weight, rebuild MEMORY.md.
```bash
docker exec overlord node /app/memory-consolidator.js
```

### `briefing`
Show the current pre-computed session briefing (server health, git activity, repairs, standing orders, recent context, trending).
```bash
cat /root/overlord/data/session-briefing.json | python3 -m json.tool
```
To rebuild it fresh:
```bash
docker exec overlord node /app/scripts/build-session-briefing.mjs && cat /root/overlord/data/session-briefing.json | python3 -m json.tool
```

### `standing-orders`
Show all high-importance rules and standing orders.
```bash
docker exec overlord node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/memory-v2.db');
const rows = db.prepare(\"SELECT id, title, narrative, importance FROM observations WHERE status = 'active' AND type = 'episodic' AND importance >= 0.8 ORDER BY importance DESC\").all();
rows.forEach(r => console.log('#' + r.id + ' [' + r.importance + '] ' + (r.narrative || r.title)));
db.close();
"
```

### `recent`
Show the most recently created episodic memories (decisions, preferences, facts).
```bash
docker exec overlord node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/memory-v2.db');
const rows = db.prepare(\"SELECT id, title, narrative, importance, tags, created_at FROM observations WHERE status = 'active' AND type = 'episodic' ORDER BY created_at DESC LIMIT 15\").all();
rows.forEach(r => {
  const date = new Date(r.created_at).toISOString().slice(0, 10);
  const tags = r.tags ? JSON.parse(r.tags) : [];
  console.log('#' + r.id + ' [' + r.importance + '] ' + (r.narrative || r.title).slice(0, 120) + ' (' + date + ', ' + tags.join('/') + ')');
});
db.close();
"
```

### `trending`
Show most frequently accessed memories in the last 7 days.
```bash
docker exec overlord node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/memory-v2.db');
const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
const rows = db.prepare(\"SELECT id, title, type, category, access_count, project FROM observations WHERE status = 'active' AND last_accessed > ? AND access_count > 0 ORDER BY access_count DESC LIMIT 15\").all(cutoff);
rows.forEach(r => console.log('#' + r.id + ' [' + r.type + '/' + (r.category || r.project || 'general') + '] ' + r.title + ' (' + r.access_count + ' hits)'));
db.close();
"
```

### `save <category/topic> "content"`
Store new semantic knowledge. Categories: tool, project, infrastructure, security, preference, person, pattern, integration.
```bash
docker exec overlord node /app/scripts/mem.mjs save <category>/<topic> "<content>"
```

### `learn "trigger" "procedure"`
Store a new procedural memory (how-to).
```bash
docker exec overlord node /app/scripts/mem.mjs learn "<trigger>" "<procedure>"
```

### `forget <id>`
Archive a memory by ID (soft delete — can be recovered).
```bash
docker exec overlord node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/memory-v2.db');
db.prepare(\"UPDATE observations SET status = 'archived', updated_at = ? WHERE id = ?\").run(Date.now(), <id>);
const row = db.prepare('SELECT title FROM observations WHERE id = ?').get(<id>);
console.log('Archived:', row ? row.title : 'not found');
db.close();
"
```

### `detail <id>`
Show full details of a specific observation.
```bash
docker exec overlord node -e "
const Database = require('better-sqlite3');
const db = new Database('/app/data/memory-v2.db');
const row = db.prepare('SELECT * FROM observations WHERE id = ?').get(<id>);
if (row) {
  console.log(JSON.stringify(row, null, 2));
} else {
  console.log('Not found');
}
db.close();
"
```

### `vacuum`
Compact the database — checkpoint WAL, vacuum, show size.
```bash
docker exec overlord node -e "
const Database = require('better-sqlite3');
const fs = require('fs');
const db = new Database('/app/data/memory-v2.db');
db.pragma('wal_checkpoint(TRUNCATE)');
const before = fs.statSync('/app/data/memory-v2.db').size;
db.exec('VACUUM');
db.close();
const after = fs.statSync('/app/data/memory-v2.db').size;
console.log('Before: ' + (before/1024).toFixed(1) + ' KB');
console.log('After: ' + (after/1024).toFixed(1) + ' KB');
console.log('Saved: ' + ((before-after)/1024).toFixed(1) + ' KB');
"
```

## Notes
- All data lives in `/root/overlord/data/memory-v2.db` (SQLite, WAL mode)
- Memory types: `semantic` (global knowledge), `episodic` (per-user facts), `procedural` (how-tos), plus `bugfix`, `config`, `discovery`, `feature` observation types
- The curator auto-extracts memories from WhatsApp conversations using free models
- Consolidation runs daily via cron (dedup, decay, boost, prune, rebuild MEMORY.md)
- Session briefing rebuilds every 30 minutes via cron
- Present results clearly to the user — summarize, don't dump raw JSON unless asked
