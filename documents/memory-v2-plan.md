# Overlord Memory v2 — Full Plan

## What This Is

A lightweight, custom-built persistent memory system for Claude Code sessions on Gil's server. Synthesized from the best ideas across three open-source projects and seven academic memory architectures — stripped to what actually matters, without the bloat.

### Research Sources

**Open-source implementations analyzed:**
- **claude-mem** (github.com/thedotmack/claude-mem, 36k stars) — per-tool-use compression, SQLite + Chroma, progressive disclosure. AGPL-3.0. Analysis: /projects/Overlord/documents/memory-v2-plan.md (this doc)
- **lossless-claw** (github.com/martian-engineering/lossless-claw, 2.1k stars) — hierarchical DAG compression, depth-aware prompts, lossless drill-down. MIT. Analysis: /projects/Overlord/documents/lossless-claw-analysis.md
- **paperclip** (github.com/paperclipai/paperclip) — browser-based AI coworker with persistent context

**Academic/industry architectures (via Turing Post, "7 Emerging Memory Architectures for AI Agents", March 2026):**
1. Unified STM/LTM Framework — agent manages its own memory lifecycle (store/retrieve/summarize/discard) as part of reasoning. RL-trained for memory efficiency.
2. Indexed Experience Memory — full interactions stored externally, compact summaries/indices in context. Retrieve full details on demand. Keeps context small for long-horizon reasoning.
3. MemRL — episodic memory + reinforcement learning. Learns which strategies work without retraining. Separates stable reasoning from flexible memory.
4. Memory Bank with CRUD — dual system: global summary + structured key-value store with create/update/delete/reorganize operations. Actively managed memory, not append-only.
5. Hierarchical Vector Memory — multi-level index caching, hybrid graph shared across agents, GPU-CPU coordination for fast search.
6. Memory-Augmented Inference (Engram) — selective lookup via sparse memory tables, routing/gating networks, hashed O(1) retrieval. Cheap access without growing context.
7. Multi-Agent Memory (Computer Architecture Perspective) — shared vs distributed memory, 3-layer hierarchy (I/O, cache, memory), memory consistency protocols.

### What We Stole From Each

| Source | Idea Adopted | Why |
|--------|-------------|-----|
| claude-mem | Observation schema, token economics tracking, progressive disclosure | Proven UX pattern, good compression structure |
| lossless-claw | Depth-aware compression prompts, fresh tail protection, parent-child linking, large file detection | Smarter compression, crash-safe, lossless drill-down |
| Indexed Experience Memory | External storage + compact context injection | Validates our progressive disclosure architecture |
| Memory Bank (CRUD) | Explicit update/delete/merge operations on observations | Prevents stale memory accumulation — memories evolve, not just pile up |
| MemRL | Strategy effectiveness tracking | Light version: tag observations with "worked"/"failed" outcomes |
| Engram | Hashed concept index for O(1) lookup | FTS5 covers this; if we outgrow it, add concept hash table |
| Multi-Agent Memory | Shared memory namespace for subagents | Future: Overlord subagents share observation context |

**Explicitly NOT adopted:** Vector DBs (Chroma/Pinecone), background HTTP workers, RL training loops, GPU-accelerated search, sub-agent delegation with token budgets. All overkill for 5 projects.

## Why Build This

**The Problem:** Claude Code forgets everything between sessions. Each new session starts cold — no knowledge of what was built yesterday, what decisions were made, what bugs were fixed, or what patterns exist across projects.

**Current State:** We have flat memory files (MEMORY.md, per-chat memory.md) that work but are:
- Manually maintained (Overlord has to decide what to remember)
- Not searchable beyond grep
- No compression — either we store everything (too verbose) or miss things
- No token economics — no idea what context costs to re-inject

**What claude-mem gets right (ideas we're stealing):**
1. Semantic compression — AI extracts meaning from raw tool outputs, not just truncation
2. Token economics tracking — know what it cost to discover something vs re-inject it
3. Progressive disclosure — compact index first, drill into details only when needed
4. Structured observations — typed, tagged, searchable memory units
5. Automatic capture — hooks capture work as it happens, no manual intervention

**What claude-mem gets wrong (why we're NOT installing it):**
1. Runs a SECOND Claude agent for EVERY tool use — dozens of extra API calls per session ($$$)
2. Heavy deps: Bun, uv, Chroma vector DB, background HTTP worker on port 37777
3. AGPL-3.0 + PolyForm license — legal headache
4. Process leaks — Chroma MCP processes don't clean up, 15GB wasted bandwidth reported
5. Slows down Claude Code noticeably (user reports in GitHub issues)
6. 62 open issues: DB race conditions, encoding bugs, empty session corruption
7. Overkill for 5 projects with a few thousand lines each

---

## Architecture

### The Session-End Problem

**Critical design constraint from Gil:** Sessions can end abruptly — crash, disconnect, kill. You CANNOT rely on a clean session-end hook to write memory. Any architecture that depends on "write summary when session ends" will lose data.

**Solution: Incremental checkpointing.** Write observations AS they happen during the session, not at the end. Two-tier approach:

- **Tier 1 (every tool use):** Lightweight metadata capture. No API call. Just log tool_name, file paths, timestamp to SQLite. Cost: ~1ms per tool use.
- **Tier 2 (every N prompts):** Batch compress accumulated raw events into structured observations. ONE API call for 10+ tool events, not 10 separate calls. Runs between user prompts so it doesn't slow down tool execution.

If a session crashes after 47 tool uses but before the next compression batch, worst case: we have 47 raw metadata rows in SQLite that the NEXT session can retroactively compress. No data lost.

### Hook Architecture

Claude Code supports lifecycle hooks. We use four:

```
PostToolUse (after every tool)
  → SQLite insert: tool_name, input_summary, timestamp
  → Check: uncompressed count >= BATCH_SIZE?
  → If yes: queue async compression

UserPromptSubmit (before each user prompt)
  → If uncompressed events exist AND count >= threshold
  → Batch compress into structured observations (1 API call)
  → Mark raw events as compressed

SessionStart (new session begins)
  → Query observations for current project
  → Progressive disclosure: inject compact context
  → Include cross-project patterns if relevant

Stop (clean session end — bonus, not required)
  → Compress any remaining uncompressed events
  → If session crashes instead, next SessionStart handles it
```

### Data Flow

```
User works in Claude Code
  ↓
Tool executes (Read, Edit, Bash, etc.)
  ↓
PostToolUse hook fires
  ↓
Raw metadata → SQLite tool_events table (~1ms, no API call)
  tool_name: "Edit"
  files: ["/projects/OnlyHulls/src/api/boats.ts"]
  params_summary: "lines 45-60, added validation"
  timestamp: 1710590400
  ↓
Every 10 tool events (or next UserPromptSubmit):
  ↓
Batch compression (1 API call, ~800 tokens total)
  ↓
Structured observation → SQLite observations table
  type: "bugfix"
  title: "Added input validation to boat API"
  narrative: "The boats endpoint accepted negative prices..."
  facts: ["Added Zod schema validation", "Catches negative prices, zero-length names"]
  concepts: ["validation", "api", "boats"]
  files_modified: ["/projects/OnlyHulls/src/api/boats.ts"]
  discovery_tokens: 12400 (what the raw tool outputs cost)
  compressed_tokens: 180 (what this observation costs to re-inject)
  ↓
Next session start:
  ↓
Context injection pulls relevant observations
  → "Last session: fixed boat API validation, added Zod schemas"
  → Available for search: memory search "validation patterns"
```

---

## SQLite Schema

**Database location:** `/projects/Overlord/data/memory-v2.db`

```sql
-- Raw tool events (cheap capture, no API call)
CREATE TABLE tool_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_summary TEXT,          -- file paths, key params only (not full output)
  output_size INTEGER,         -- bytes of raw output (for token economics)
  timestamp INTEGER NOT NULL,
  compressed INTEGER DEFAULT 0 -- 0=raw, 1=compressed into observation
);

CREATE INDEX idx_tool_events_session ON tool_events(session_id);
CREATE INDEX idx_tool_events_uncompressed ON tool_events(compressed, timestamp);

-- Compressed observations (AI-extracted meaning)
-- Supports full CRUD: create, update, delete, merge
CREATE TABLE observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project TEXT NOT NULL,
  type TEXT NOT NULL,           -- decision | bugfix | feature | refactor | discovery | config
  title TEXT NOT NULL,          -- max 80 chars
  subtitle TEXT,               -- max 120 chars
  narrative TEXT,              -- 1-3 sentence explanation
  facts TEXT,                  -- JSON array of bullet points
  concepts TEXT,               -- JSON array of tags
  files_read TEXT,             -- JSON array of file paths
  files_modified TEXT,         -- JSON array of file paths
  outcome TEXT,                -- "worked" | "failed" | "partial" | NULL (strategy tracking from MemRL)
  outcome_note TEXT,           -- why it worked/failed (for learning)
  depth INTEGER DEFAULT 0,     -- compression depth (0=leaf, 1=session, 2=arc, 3+=strategic)
  parent_id INTEGER,           -- links to parent observation after compression (lossless drill-down)
  superseded_by INTEGER,       -- points to newer observation that replaces this one (CRUD update)
  status TEXT DEFAULT 'active', -- active | superseded | merged | archived
  discovery_tokens INTEGER,    -- tokens consumed to learn this
  compressed_tokens INTEGER,   -- tokens to re-inject this observation
  created_at INTEGER NOT NULL,
  updated_at INTEGER,          -- last CRUD modification
  FOREIGN KEY (parent_id) REFERENCES observations(id),
  FOREIGN KEY (superseded_by) REFERENCES observations(id)
);

CREATE INDEX idx_observations_project ON observations(project, created_at);
CREATE INDEX idx_observations_type ON observations(type);
CREATE INDEX idx_observations_active ON observations(status) WHERE status = 'active';
CREATE INDEX idx_observations_depth ON observations(depth);
CREATE INDEX idx_observations_parent ON observations(parent_id);

-- CRUD audit log (track memory mutations)
CREATE TABLE observation_mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL,
  mutation_type TEXT NOT NULL,   -- create | update | delete | merge | supersede | archive
  old_value TEXT,               -- JSON snapshot before change (NULL for create)
  new_value TEXT,               -- JSON snapshot after change (NULL for delete)
  reason TEXT,                  -- why this mutation happened
  session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  FOREIGN KEY (observation_id) REFERENCES observations(id)
);

-- FTS5 full-text search index
CREATE VIRTUAL TABLE observations_fts USING fts5(
  title, subtitle, narrative, facts, concepts,
  content=observations,
  content_rowid=id
);

-- Triggers to keep FTS in sync (handles INSERT, DELETE, and UPDATE for CRUD)
CREATE TRIGGER observations_ai AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, title, subtitle, narrative, facts, concepts)
  VALUES (new.id, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
END;

CREATE TRIGGER observations_ad AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, facts, concepts)
  VALUES ('delete', old.id, old.title, old.subtitle, old.narrative, old.facts, old.concepts);
END;

CREATE TRIGGER observations_au AFTER UPDATE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, facts, concepts)
  VALUES ('delete', old.id, old.title, old.subtitle, old.narrative, old.facts, old.concepts);
  INSERT INTO observations_fts(rowid, title, subtitle, narrative, facts, concepts)
  VALUES (new.id, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
END;

-- Session metadata
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,          -- Claude Code session ID
  project TEXT NOT NULL,
  user_prompt TEXT,             -- first prompt of the session
  started_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  tool_event_count INTEGER DEFAULT 0,
  observation_count INTEGER DEFAULT 0
);
```

---

## Progressive Disclosure (Context Injection)

When a new session starts, DON'T dump everything. Layer the context:

**Layer 1 — Always injected (~200-400 tokens):**
```
MEMORY CONTEXT (auto-generated):
Recent sessions for this project:
- [2026-03-15] Fixed boat API validation, added Zod schemas (3 observations)
- [2026-03-14] Refactored image upload to use R2 directly (2 observations)
- [2026-03-13] Added webhook retry logic for Stripe (4 observations)

Cross-project patterns:
- Validation: Zod schemas used in OnlyHulls, NamiBarden
- Deploy: docker cp + restart for Overlord, SurfaBabe

Use "memory search <query>" to drill into details.
```

**Layer 2 — On demand via search (~500 tokens):**
```
> memory search "validation"

3 observations found:
1. [bugfix] Added input validation to boat API
   Facts: Added Zod schema, catches negative prices/zero-length names
   Files: /projects/OnlyHulls/src/api/boats.ts

2. [feature] Form validation for course enrollment
   Facts: Client-side Zod, server mirrors validation, error toast on fail
   Files: /projects/NamiBarden/src/components/EnrollForm.tsx

3. [decision] Chose Zod over Joi for validation
   Narrative: Zod has better TS inference, smaller bundle, same API surface...
```

**Layer 3 — Full detail on specific observation:**
```
> memory detail 3

[decision] Chose Zod over Joi for validation
Session: 2026-03-10 (OnlyHulls)
Narrative: Evaluated Zod vs Joi vs Yup for API + client validation. Zod won
because it infers TypeScript types from schemas (no duplicate type definitions),
has a smaller bundle size (12KB vs 28KB for Joi), and the parse/safeParse API
is cleaner. Joi has better error messages out of the box but Zod's .refine()
covers our cases.
Facts:
- Zod: 12KB, TS-native, parse/safeParse API
- Joi: 28KB, better errors, no TS inference
- Both handle nested objects, arrays, unions
- Decision: Zod for all new validation, don't migrate existing Joi
Concepts: validation, architecture, dependencies
Discovery cost: 8,200 tokens | Storage cost: 290 tokens (96.5% compression)
```

---

## Compression Prompt

When batch compression triggers, this prompt processes accumulated tool events:

```
You are a memory compression agent. Given a batch of raw tool events from a
Claude Code session, extract the meaningful observations.

Rules:
- Skip trivial reads (reading a file just to understand it = no observation)
- Skip failed commands that were immediately retried
- Group related events (read file → edit file → test = one observation)
- Extract DECISIONS, not just actions ("chose X over Y because Z")
- Track files that were actually modified (not just read)
- Each observation should be independently useful in a future session

For each observation, output:
<observation>
  <type>decision|bugfix|feature|refactor|discovery|config</type>
  <title>Short title (max 80 chars)</title>
  <subtitle>One-line context (max 120 chars)</subtitle>
  <narrative>1-3 sentences explaining what happened and WHY</narrative>
  <facts>
    <fact>Concrete, reusable fact</fact>
  </facts>
  <concepts>
    <concept>searchable tag</concept>
  </concepts>
  <files_read>
    <file>/absolute/path</file>
  </files_read>
  <files_modified>
    <file>/absolute/path</file>
  </files_modified>
</observation>

Raw tool events to process:
{batch_of_events}
```

---

## File Structure

```
/projects/Overlord/skills/memory-v2/
  SKILL.md                    -- Skill definition (name, description, triggers)
  scripts/
    memory-v2.sh              -- Main entry point
    init-db.sh                -- Initialize SQLite database
    compress.sh               -- Batch compression script
    search.sh                 -- Search interface
    inject-context.sh         -- Context injection for session start
    stats.sh                  -- Token economics dashboard
  hooks/
    post-tool-use.sh          -- Lightweight event capture
    prompt-submit.sh          -- Trigger batch compression
    session-start.sh          -- Context injection
    session-stop.sh           -- Final compression (bonus, not required)

/projects/Overlord/data/
  memory-v2.db                -- SQLite database (auto-created by init-db.sh)
```

---

## Commands

```
memory init                   -- Create database, set up hooks
memory search <query>         -- FTS5 search across all observations
memory search <query> --project onlyhulls  -- Scoped search
memory detail <id>            -- Full observation with token economics
memory sessions               -- List recent sessions with observation counts
memory stats                  -- Token economics dashboard
memory compress               -- Force compression of pending events
memory prune --older-than 90d -- Archive observations older than 90 days

-- CRUD operations (Memory Bank pattern)
memory update <id> --fact "new fact"      -- Update an observation with new info
memory update <id> --outcome worked       -- Mark strategy as worked/failed/partial
memory supersede <id> --reason "..."      -- Mark observation as replaced by newer one
memory merge <id1> <id2>                  -- Merge two related observations into one
memory delete <id> --reason "..."         -- Soft-delete (status=archived, audit logged)
memory history <id>                       -- Show mutation history for an observation

-- Hierarchy (lossless-claw pattern)
memory elevate                            -- Compress D0 observations into D1 session summaries
memory drill <id>                         -- Show children of a compressed observation
memory export                             -- Dump all observations as JSON
```

## CRUD Operations — Design (from Memory Bank architecture)

The key insight from the Memory Bank paper: memories should be ACTIVELY MANAGED, not just appended. An agent that can only add memories but never correct or remove them accumulates noise over time.

**UPDATE**: When new information contradicts or extends an existing observation. Example: "We chose Zod over Joi" gets updated with "Switched from Zod to Valibot after bundle size audit." The old version is preserved in observation_mutations for drill-down.

**SUPERSEDE**: When a new observation completely replaces an old one. The old observation gets `superseded_by` pointing to the new one, and `status='superseded'`. Context injection skips superseded observations. Drill-down still works.

**MERGE**: When two observations are really about the same thing (e.g., "fixed API validation" and "added Zod schemas to boats endpoint"). Creates a new combined observation, marks both originals as `status='merged'`.

**DELETE (soft)**: Sets `status='archived'`. Never hard-deletes (lossless principle). Mutation log records who/when/why.

**OUTCOME TRACKING (from MemRL)**: After a strategy is applied and we know the result, tag the observation:
- `outcome: "worked"` — strategy succeeded, prioritize in future context injection
- `outcome: "failed"` — strategy failed, include as cautionary context
- `outcome: "partial"` — mixed results, include with caveats
- `outcome_note` — freeform explanation of WHY

This means context injection can say: "Last time you tried X approach for this kind of problem, it failed because Y. Consider Z instead."

## Depth-Aware Compression (from lossless-claw)

Observations form a hierarchy. Each depth level gets a DIFFERENT compression prompt:

**Depth 0 (leaf)**: Raw observations from tool events. "Preserve decisions, rationale, specific file operations, exact error messages."

**Depth 1 (session)**: Multiple D0 observations compressed into a session summary. "Session-level view. Drop dead ends and failed attempts that were immediately corrected. Keep conclusions, decisions, and what was actually shipped."

**Depth 2 (arc)**: Multiple D1 session summaries compressed into a multi-session arc. "Extract the project arc. What capability was being built? What architectural direction emerged? Not per-session details."

**Depth 3+ (strategic)**: High-level patterns across arcs. "What would a new team member need to know about this project? Not what happened — what matters."

**Fresh tail protection**: The last N observations (configurable, default 20) are NEVER compressed, regardless of age. This ensures recent context is always available at full fidelity. Only observations older than the tail get elevated to higher depths.

**Parent-child linking**: When D0 observations compress into a D1, the D1 gets `parent_id=NULL` and each D0 gets `parent_id=D1.id`. `memory drill <D1_id>` shows all child D0 observations. True lossless — you can always get back to the raw details.

---

## Token Economics

**Cost per session (estimated):**

| Operation | claude-mem | Memory v2 |
|-----------|-----------|-----------|
| Per tool use | ~2000 tokens (API call) | ~0 tokens (SQLite insert) |
| Batch compression (per 10 events) | N/A (does per-event) | ~800 tokens (1 API call) |
| 50-tool session total | ~100,000 extra tokens | ~4,000 extra tokens |
| Context injection | ~500 tokens | ~300 tokens |

**25x cheaper per session.** For a heavy day with 5 sessions averaging 50 tool uses each, that's ~500K tokens saved vs claude-mem's approach.

**Compression ratio tracking:**
- Each observation stores `discovery_tokens` (raw cost) and `compressed_tokens` (storage cost)
- Dashboard shows: "Your memory contains 340 observations compressed from 2.1M discovery tokens into 85K storage tokens (96% compression)"

---

## Implementation Phases

### Phase 1 — Core (build first)
- SQLite schema + init script (full schema with CRUD columns, mutation log, depth hierarchy)
- PostToolUse hook (metadata capture)
- Batch compression script (depth-0 observations)
- Basic search (FTS5)
- Manual triggers: `memory compress`, `memory search`, `memory detail`
- CRUD commands: `memory update`, `memory delete`, `memory supersede`

### Phase 2 — Automation
- UserPromptSubmit hook (auto-compress)
- SessionStart hook (context injection with progressive disclosure)
- Context injection filters: skip superseded/archived, prioritize "worked" outcomes
- Token economics tracking
- Outcome tagging: prompt asks "did this work?" after related tasks complete
- Fresh tail protection (last 20 observations exempt from elevation)

### Phase 3 — Intelligence
- Depth elevation: D0→D1 (session), D1→D2 (arc), D2→D3+ (strategic)
- Cross-project pattern detection ("you use Zod everywhere")
- Decision recall with outcome context ("last time you tried X, it failed because Y")
- Merge detection: flag observations that look like duplicates, suggest merge
- Strategy learning: surface observations tagged "worked" for similar problems
- Auto-archive: observations older than 90 days AND superseded/low-access get archived
- Stats dashboard with compression ratios per depth level

### Phase 4 — Multi-Agent (future, if needed)
- Shared observation namespace for Overlord subagents
- Memory consistency protocol (prevent concurrent writes from corrupting)
- Agent-scoped views (subagent sees only relevant project slice)
- Inspired by: Multi-Agent Memory from Computer Architecture Perspective paper

---

## Dependencies

**Required (already on server):**
- SQLite3 (already installed)
- Claude CLI (already installed)
- jq (already installed)
- bash (obviously)

**NOT required (avoided intentionally):**
- No Bun
- No Python / uv
- No Chroma / vector DB
- No background HTTP worker
- No additional ports

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Session crashes before compression | Raw events survive in SQLite; next session compresses them retroactively |
| SQLite corruption | WAL mode + regular backups via existing db-ops skill |
| Compression API call fails | Events stay uncompressed; retry next batch |
| Context injection too verbose | Progressive disclosure — compact by default, detail on demand |
| FTS5 search quality insufficient | If we outgrow FTS5, THEN consider adding vector search (not before) |
| Hooks slow down Claude Code | PostToolUse is SQLite-only (~1ms); compression runs between prompts |

---

## Open Questions for Gil

1. **Batch size:** Compress every 10 tool events or every 5? More frequent = more API calls but less data at risk.
2. **Cross-project context:** Should session start inject observations from OTHER projects, or only the current one?
3. **Retention:** Keep observations forever, or auto-archive after N days? (Soft-delete means nothing is truly lost.)
4. **Scope:** Start with all projects, or pilot on one (OnlyHulls recommended — largest codebase)?
5. **Outcome prompting:** Should the system proactively ask "did this approach work?" after fixes/features, or only track outcomes when explicitly told?
6. **Elevation frequency:** How often should D0→D1 compression run? Daily? Weekly? After N observations accumulate?
7. **Fresh tail size:** 20 observations protected from compression, or more/fewer?

---

## References

- claude-mem source: github.com/thedotmack/claude-mem (cloned and analyzed)
- lossless-claw source: github.com/martian-engineering/lossless-claw (cloned and analyzed)
- paperclip source: github.com/paperclipai/paperclip (reviewed)
- Turing Post: "7 Emerging Memory Architectures for AI Agents" (March 2026) — turingpost.com/p/agenticmemory
- Claude Code hooks spec: hooks fire on PostToolUse, UserPromptSubmit, SessionStart, Stop
- SQLite FTS5 docs: sqlite.org/fts5.html
- Observation schema: claude-mem XML format + Memory Bank CRUD + lossless-claw depth hierarchy
