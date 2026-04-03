---
name: save
version: 1.0.0
description: |
  Save current work session to memory for later /resume. Captures: what we're working on,
  which files were touched, current state (working/broken/blocked), next steps, and any
  decisions or context that would be lost between sessions.
  Use when: "save", "save session", "save progress", "I'm leaving", "brb", "stepping away",
  "save state", "bookmark this". (Overlord Stack)
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
---

# /save -- Session State Capture

You are saving a work-in-progress snapshot so a future Claude session can pick up exactly where we left off.

## What to Capture

Build a complete picture by gathering these signals. Do NOT ask the user questions -- figure it out from context and the environment.

### 1. Conversation Context

Review the current conversation to extract:
- **Goal**: What is the user trying to accomplish? (the "why")
- **Approach**: What strategy/plan are we following? (the "how")
- **Decisions made**: Any non-obvious choices, tradeoffs, or rejected alternatives
- **Blockers or open questions**: Anything unresolved

### 2. Environment State

Run these checks to capture the current state of the working directory:

```bash
# Where are we?
pwd

# Git state
git status --short 2>/dev/null
git branch --show-current 2>/dev/null
git log --oneline -5 2>/dev/null
git diff --stat 2>/dev/null
git stash list 2>/dev/null
```

Extract:
- **Project**: Which project (match to known projects in CLAUDE.md)
- **Branch**: Current branch and whether it's clean or dirty
- **Recent commits**: Last few commits for context
- **Uncommitted changes**: What's modified but not committed
- **Stashed work**: Anything stashed

### 3. Files in Play

Identify the key files involved in the current work:
- Files that were read, edited, or created during this session
- Files mentioned in conversation as relevant
- Config files that were changed

### 4. Current State Assessment

Classify the work state:
- **working**: Code compiles/runs, last change was successful
- **broken**: Something is failing, include the error
- **blocked**: Waiting on something external (user decision, API key, etc.)
- **partial**: Mid-implementation, some parts done, some not
- **planning**: Still in design/planning phase, no code changes yet

### 5. Next Steps

What should the next session do first? Be specific:
- If mid-implementation: which file, which function, what's left
- If debugging: what was the last hypothesis, what's been ruled out
- If blocked: what's needed to unblock
- If a plan exists: which step we're on

## Output Format

Write the session save to `/root/.claude/projects/-root/memory/session_save.md` using this exact structure:

```markdown
---
name: session-save
description: Work-in-progress session state for /resume -- {one-line summary of the work}
type: project
---

# Session Save
**Saved**: {YYYY-MM-DD HH:MM UTC}
**Project**: {project name}
**Branch**: {branch name} ({clean|dirty})
**State**: {working|broken|blocked|partial|planning}

## Goal
{What we're trying to accomplish, in 1-3 sentences}

## Context & Decisions
{Key decisions, tradeoffs, rejected alternatives -- anything non-obvious that would be lost}

## What Was Done
{Bullet list of concrete actions taken this session}
- {action 1}
- {action 2}

## Files Touched
{List of files that matter, with brief note on what was changed}
- `path/to/file.js` -- {what changed}

## Current State
{Honest assessment: what works, what doesn't, what's half-done}

## Uncommitted Changes
{Output of git status --short, or "None -- all committed"}

## Next Steps (in order)
1. {First thing to do when resuming}
2. {Second thing}
3. {Third thing if applicable}

## Errors / Blockers
{Any active errors, stack traces (abbreviated), or blockers. "None" if clean.}
```

## After Saving

1. Also update `/root/.claude/projects/-root/memory/MEMORY.md` index -- add or update the session-save entry:
   ```
   - [Session Save](session_save.md) -- {project}: {one-line summary of state}
   ```

2. **Verify the save** by reading back `session_save.md` and confirming it contains enough context to resume cold.

3. Report to the user in this format:
   ```
   Session saved. State: {state}
   Project: {project} ({branch})
   Next: {first next step, abbreviated}
   
   /resume will pick this up in a new session.
   ```

## Rules

- **No questions** -- gather everything from context and environment. The user said /save because they're leaving.
- **Be honest about state** -- if something is broken, say so. Don't sugarcoat.
- **Include errors verbatim** -- if there's an active error, include enough of it to debug without re-running.
- **Overwrite previous saves** -- there's only one active session save. Old ones get replaced.
- **Speed matters** -- user is stepping away. Don't spend 30 seconds on this. Capture and confirm.
