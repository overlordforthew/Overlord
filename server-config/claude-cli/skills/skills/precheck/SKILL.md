---
name: precheck
version: 1.0.0
description: |
  Pre-commit code review. Analyzes staged diff for bugs, secrets, debug leftovers,
  error handling gaps, and common mistakes. Lighter than a full PR review.
  Use when: "precheck", "review my changes", "check before commit", "look at my diff",
  "code review", "anything wrong with this". (Overlord Stack)
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# /precheck -- Pre-Commit Review

Fast diff review before committing. Catches the things that slip past "it works on my machine."

## Step 1: Get the Diff

```bash
git diff --cached --stat
git diff --cached
```

If nothing staged, check unstaged:
```bash
git diff --stat
git diff
```

If both empty: "Nothing to review. Stage your changes first (`git add <files>`)."

## Step 2: Scan for Problems

Review every changed file. Check for these categories:

### 2.1 Secrets & Credentials
- Hardcoded API keys, tokens, passwords
- .env files being committed
- Private keys, certificates
- Database connection strings with credentials
- Webhook URLs with tokens embedded

If found: **STOP. Do not proceed.** Tell the user what was found and where.

### 2.2 Debug Leftovers
- `console.log` / `console.debug` / `console.warn` statements (except in logging modules)
- `debugger` statements
- `TODO` / `FIXME` / `HACK` comments (flag, don't block)
- Commented-out code blocks (more than 3 lines)
- `alert()` in frontend code

### 2.3 Common Bugs
- **Async/await:** Missing `await` on async calls, unhandled promise rejections
- **Error handling:** Empty catch blocks, swallowed errors, missing error responses
- **Null safety:** Property access on potentially null/undefined values
- **SQL injection:** String concatenation in queries instead of parameterized
- **XSS:** Unsanitized user input rendered in HTML
- **Race conditions:** Shared state modified without locks in concurrent code
- **Resource leaks:** Opened connections/files/streams not closed in error paths
- **Off-by-one:** Loop bounds, array indexing, substring operations

### 2.4 Style & Quality
- Functions over 50 lines (flag for potential splitting)
- Deeply nested conditionals (3+ levels)
- Magic numbers without constants
- Inconsistent naming (camelCase vs snake_case mixing in same file)
- Dead code (unreachable branches, unused imports)

### 2.5 Overlord-Specific (if in /root/overlord/)
- Message handler changes without corresponding test scenarios
- Router changes without updating MODEL_REGISTRY documentation
- Memory system changes without checking migration compatibility
- Scheduler changes without verifying cron expression syntax
- New dependencies that could bloat the 2GB container memory limit

## Step 3: Report

```
PRECHECK -- [branch] -- [N files changed, +X/-Y lines]
=====================================================

[For each finding:]
[SEVERITY] [file:line] [category]
  [One-line description]
  [Suggested fix if non-obvious]

SUMMARY:
  Secrets:     [CLEAN / BLOCKED]
  Debug:       [CLEAN / N items]
  Bugs:        [CLEAN / N potential issues]
  Style:       [CLEAN / N suggestions]

VERDICT: [READY TO COMMIT / FIX N ISSUES FIRST]
```

Severity levels:
- **BLOCK** -- Must fix before commit (secrets, clear bugs)
- **WARN** -- Should fix, but won't break prod (debug leftovers, style)
- **INFO** -- FYI, no action needed (TODOs, minor style)

## Auto-Fix

For WARN-level issues that have obvious fixes (removing console.log, adding missing await),
offer to fix them:

> Found N auto-fixable issues. Want me to fix them?
> A) Fix all
> B) Show me each one
> C) Skip, I'll handle it
