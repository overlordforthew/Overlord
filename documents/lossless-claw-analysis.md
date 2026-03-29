# Lossless-Claw Analysis + Comparison to claude-mem

## What It Is

A context management plugin for OpenClaw (open-source Claude Code alternative). Instead of the standard sliding-window approach (truncate old messages when context fills up), it builds a DAG (directed acyclic graph) of hierarchical summaries. Nothing is ever deleted. Raw messages persist in SQLite, summaries link back to source messages, and agents can drill into any summary to recover original detail.

MIT licensed. 2,100 stars. 124 commits. Last commit: March 15, 2026 (yesterday). v0.3.0. Very active development.

Author: Josh Lehman / Martian Engineering. Built on the LCM (Lossless Context Management) paper from Voltropy.

---

## How It Actually Works

### The Core Insight: Hierarchical Summarization

Instead of "remember what happened" (claude-mem's approach), lossless-claw solves "never forget anything, ever" by building a tree of increasingly compressed summaries.

### The DAG Structure

```
Raw Messages (depth -1)
  ↓ leaf pass
Leaf Summaries (depth 0) — ~600 tokens each, from ~20,000 tokens of raw messages
  ↓ condensed pass
D1 Summaries (depth 1) — ~900 tokens each, condensing 8+ leaves
  ↓ condensed pass
D2 Summaries (depth 2) — ~900 tokens, condensing 4+ D1 nodes
  ↓ condensed pass
D3+ Summaries (depth 3+) — ~900 tokens, condensing 3+ D2 nodes
```

Every node in the DAG links to its children. Every leaf links to its source messages. You can traverse DOWN from any summary to recover the original raw messages.

### When Compaction Triggers

- Context threshold: when context usage hits 75% of model's token window
- Leaf trigger: when raw tokens outside the "fresh tail" exceed 20,000
- The "fresh tail" is the last 32 messages — always protected, never compressed

### The Compaction Pipeline

Phase 1 — Leaf passes:
- Takes oldest raw messages (up to 20k tokens)
- Summarizes into ~600 token leaf node
- Repeats until no more raw chunks outside fresh tail

Phase 2 — Condensation passes:
- Finds shallowest depth with enough nodes (8+ leaves or 4+ condensed)
- Summarizes them into a higher-depth node (~900 tokens)
- Cascades upward until nothing qualifies

Escalation: normal → aggressive → deterministic truncation (failsafe)

### Compression Ratios

| Level | Input | Output | Ratio |
|-------|-------|--------|-------|
| Raw → Leaf (D0) | ~20,000t | ~600t | 97% compression |
| D0 → D1 | ~4,800t (8 leaves) | ~900t | 81% compression |
| D1 → D2 | ~3,600t (4 D1s) | ~900t | 75% compression |
| D2 → D3+ | ~2,700t (3 D2s) | ~900t | 67% compression |
| End-to-end (100k raw) | 100,000t | ~900t | 99.1% compression |

### Depth-Aware Prompts

Each summarization level gets a different prompt:

- Leaf: "Preserve decisions, rationale, constraints, active tasks. Track file operations."
- D1: "Compact session-level context. Drop dead ends, keep conclusions. Mention causality."
- D2: "Extract the arc from sessions. Focus on decisions in effect, not per-session details."
- D3+: "What would I need to know? Not what happened. Ruthlessly concise. Drop operational detail."

This is genuinely smart — each level of abstraction gets guidance appropriate to its role.

### Agent Tools for Retrieval

Three tools available to the AI during conversation:

1. lcm_grep — Search across ALL compacted history (FTS5 + LIKE + regex fallback)
2. lcm_describe — Inspect a summary's metadata, lineage, and subtree manifest
3. lcm_expand_query — Ask a focused question, spawns a sub-agent to traverse the DAG and find the answer

The expand_query tool is the clever part: it creates a time-limited, scoped delegation grant for a sub-agent, which traverses the DAG within a token budget, then returns a synthesized answer. Main agent never sees the raw traversal — just the answer.

### Large File Handling

Files over 25k tokens are automatically intercepted, stored separately, and replaced with an exploration summary. Deterministic parsers for JSON, CSV, XML, YAML, code files. AI summarization fallback for text/markdown. Files queryable via lcm_describe with file IDs.

---

## Head-to-Head: lossless-claw vs claude-mem

| Dimension | lossless-claw | claude-mem |
|-----------|---------------|-----------|
| **Core approach** | Hierarchical DAG of summaries, raw messages preserved | Per-tool-use observation extraction, flat storage |
| **When it compresses** | When context window fills (75% threshold) | After every tool use |
| **Compression method** | Multi-depth summarization with cascading | AI extracts structured observations per event |
| **Data preserved** | EVERYTHING — raw messages + all summary levels | Compressed observations only (raw output discarded) |
| **Search** | FTS5 + regex + DAG traversal tools | FTS5 + Chroma vector embeddings |
| **Retrieval** | Agent-driven DAG expansion (sub-agent delegation) | Progressive disclosure (3 layers) |
| **API cost per session** | Summarization calls only when compaction triggers (few per session) | API call for EVERY tool use (dozens per session) |
| **Dependencies** | SQLite, Node.js 22+, OpenClaw | SQLite, Chroma, Bun, uv, background HTTP worker |
| **License** | MIT | AGPL-3.0 + PolyForm |
| **Stars** | 2,100 | 36,000 |
| **Maturity** | v0.3.0, early but well-architected | More mature but more open issues |
| **Platform** | OpenClaw only (not Claude Code) | Claude Code hooks |
| **Token overhead** | Low — only summarizes when needed | High — processes every tool output |
| **Recovery from crash** | Graceful — raw messages in DB, summaries resume | Depends on checkpoint timing |
| **Large file handling** | Yes — auto-intercept + exploration summaries | No dedicated handling |
| **Cross-session** | Yes — conversations persist in SQLite | Yes — observations persist across sessions |

### Where lossless-claw wins:
1. **True losslessness** — raw messages NEVER deleted, always recoverable via DAG traversal
2. **Much cheaper** — only calls LLM when compaction triggers, not per-tool-use
3. **Smarter compression** — depth-aware prompts (leaf vs session vs phase-level abstraction)
4. **Sub-agent delegation** — controlled, budget-aware DAG traversal with authorization grants
5. **MIT license** — no legal concerns
6. **Large file handling** — automatic interception and structured exploration
7. **Token budget awareness** — expansion policy prevents runaway costs

### Where claude-mem wins:
1. **Works with Claude Code** — lossless-claw is OpenClaw only
2. **Vector search** — Chroma semantic embeddings find things FTS5 might miss
3. **Structured observations** — typed, tagged, concept-indexed memory units
4. **Simpler mental model** — observation + search vs DAG traversal
5. **Broader community** — 36k stars, more users, more feedback
6. **Web UI** — browse memory visually on port 37777
7. **Token economics dashboard** — tracks discovery vs storage costs

### Where both have issues:
- lossless-claw: compaction overshoot bugs, cross-session data leakage, no cost controls on LLM spending, 37 open issues
- claude-mem: process leaks, slows Claude Code, DB race conditions, AGPL license, 62 open issues

---

## What This Means for Our Memory v2 Plan

### Ideas to steal from lossless-claw:

1. **Depth-aware summarization prompts** — our batch compression should use different prompts for different contexts (recent work vs historical patterns vs architectural decisions)

2. **Fresh tail concept** — always protect the last N operations from compression. Don't summarize work that's still in progress.

3. **DAG structure for summaries** — instead of flat observations, link summaries to their source events. Enables drill-down when needed.

4. **Large file interception** — when a tool reads a huge file, store a smart summary instead of the raw output.

5. **Expansion policy** — budget-aware retrieval that estimates cost before expanding, preventing runaway context injection.

### Ideas NOT to adopt:

1. **OpenClaw dependency** — we're on Claude Code, not OpenClaw
2. **Sub-agent delegation** — overkill for our scale, adds complexity
3. **Multi-depth condensation** — our conversations aren't long enough to need D3+ summaries
4. **Go TUI** — we don't need a terminal UI for memory management

### Revised Memory v2 architecture (incorporating lossless-claw insights):

The original plan is solid, but add:
- Fresh tail protection (last 10 tool events never auto-compressed)
- Depth-aware compression prompts (recent session vs cross-session pattern)
- Parent-child linking in observations (so you can trace back to source events)
- Large file detection (store summary instead of raw content for files > 10k tokens)
- Token budget cap on context injection (never inject more than X tokens at session start)

---

## Bottom Line Recommendation

lossless-claw is the more sophisticated and principled system. claude-mem is the more popular and accessible one. Neither works directly for us (lossless-claw needs OpenClaw, claude-mem is too heavy).

For our Memory v2 build:
- Steal the DAG concept and depth-aware prompts from lossless-claw
- Steal the observation schema and token economics from claude-mem
- Keep our lightweight hook-based architecture (no background workers, no vector DB)
- Build it as a Claude Code skill, not a plugin

This gives us the best ideas from both without their respective baggage.
