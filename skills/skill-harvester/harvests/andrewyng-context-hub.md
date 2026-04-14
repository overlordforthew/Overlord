# Harvest Report: andrewyng/context-hub

**Harvested**: 2026-03-17
**Source**: https://github.com/andrewyng/context-hub
**Stars**: 8,900+
**License**: MIT
**Language**: JavaScript (Node.js 18+)
**Files Analyzed**: 1,738
**Tools Found**: 35
**Prompts Found**: 9

## What It Does
CLI tool giving coding agents curated, versioned API documentation to prevent hallucination.
Commands: search, get, annotate, feedback. Built-in Claude Code integration via skills.

## Patterns Extracted

### 1. Annotation System (IMPLEMENTED)
**Source**: `cli/src/lib/annotations.js` + `cli/src/commands/annotate.js`
**What**: Persistent JSON notes attached to entries. Agents annotate docs when they find gaps.
Notes auto-surface on subsequent fetches — so the same mistake isn't repeated.
**Adapted to**: `skill-learner.js` — writeAnnotation(), readAnnotation(), listAnnotations(), clearAnnotation()
**Storage**: `/app/data/skill-annotations/<skill-name>.json`

### 2. Feedback/Quality Tracking (IMPLEMENTED)
**Source**: `cli/src/commands/feedback.js` + `cli/src/lib/telemetry.js`
**What**: Structured up/down ratings with labels (accurate, outdated, incomplete, broken-script, etc.).
Feedback accumulates per-entry, creating a quality score over time.
**Adapted to**: `skill-learner.js` — feedbackSkill(), getSkillFeedbackSummary(), getSkillsNeedingAttention()
**Storage**: `/app/data/skill-feedback.json`
**Labels**: accurate, well-structured, helpful, good-examples, outdated, inaccurate, incomplete, wrong-examples, broken-script, missing-dependency, needs-update

### 3. Incremental Fetching (PATTERN NOTED)
**Source**: `cli/src/commands/get.js` — `--file` and `--full` flags
**What**: Agents fetch only the section they need (--file specific.md) vs everything (--full).
Saves tokens by not dumping entire skill docs when only one section is relevant.
**Status**: Noted for future implementation. Our SKILL.md files could support section headers
that allow partial loading, but this requires changes to how Claude Code reads skills.

## Architecture Notes
- BM25 search index for fast local matching (cli/src/lib/bm25.js)
- PostHog analytics for usage tracking (we don't need this — our feedback system is local)
- Multi-source registry with local + remote sources and caching
- Content stored as markdown with YAML frontmatter — same as our SKILL.md format
- MCP server built in (cli/src/mcp/server.js) for tool-based access

## Not Extracted (and why)
- **BM25 search**: Our skills are loaded by Claude Code's skill system, not searched via CLI
- **Remote registry/CDN**: We don't distribute skills externally
- **PostHog analytics**: We track locally, no need for cloud analytics
- **MCP server**: Interesting but premature — our skills work fine as file reads
