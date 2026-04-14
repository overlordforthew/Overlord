---
name: code-review
version: 1.0.0
description: "Structured code review with priority markers, security focus, and actionable feedback. Adapted from agency-agents Code Reviewer pattern."
---

# Code Review

Structured code review skill for Overlord. Every comment prioritized, every issue actionable, every review teaches something.

## Priority Markers

Every review comment MUST use one of these markers:

| Marker | Level | Meaning | Action Required |
|--------|-------|---------|-----------------|
| BLOCKER | Critical | Security vuln, data loss risk, breaking change, race condition | Must fix before merge |
| SUGGESTION | Important | Missing validation, unclear logic, missing tests, perf issue, duplication | Should fix |
| NIT | Minor | Style inconsistency, naming improvement, docs gap, alternative approach | Nice to have |
| PRAISE | Positive | Clever solution, clean pattern, good test coverage | Keep doing this |

## Review Comment Format

```
[BLOCKER] Security: SQL Injection Risk
File: src/api/users.js:42
User input interpolated directly into query.

Why: Attacker can inject '; DROP TABLE users; -- as the name parameter.

Fix: Use parameterized queries:
  db.query('SELECT * FROM users WHERE name = $1', [name])
```

## Review Checklist

### Pass 1: Spec Compliance
- Does the code do what was actually requested?
- Are edge cases handled per requirements?
- Any missing functionality from the original ask?
- Any scope creep (unrequested changes)?

### Pass 2: Blockers (must catch)
- SQL injection, XSS, command injection, path traversal
- Auth/authz bypass, missing permission checks
- Data loss or corruption paths
- Race conditions, deadlocks
- Breaking API contracts or backwards compatibility
- Hardcoded secrets, credentials, API keys
- Missing error handling on critical paths

### Pass 3: Suggestions (should catch)
- Missing input validation at system boundaries
- N+1 queries, unnecessary allocations, obvious perf issues
- Unclear naming, confusing control flow
- Missing tests for important behavior
- Code duplication that warrants extraction
- Error messages that leak internal details

### Pass 4: Nits (nice to catch)
- Inconsistent style (if no linter)
- Minor naming improvements
- Dead code, unused imports
- Documentation gaps on public APIs

## Review Summary Format

```
## Review Summary

Overall: [APPROVE / REQUEST CHANGES / NEEDS DISCUSSION]

Blockers: X | Suggestions: X | Nits: X | Praise: X

### Key Concerns
1. [Most important issue]
2. [Second issue]

### What's Good
- [Positive callout]

### Verdict
[One sentence: what needs to happen before this ships]
```

## How Overlord Uses This

When reviewing code (manually or as part of deploy protocol):
1. Run Pass 1 (spec compliance) — does it match the ask?
2. Run Pass 2-4 sequentially — never combine passes
3. If any BLOCKER found, stop and fix before continuing
4. Generate summary with counts and verdict
5. For auto-reviews (pre-deploy), only block on BLOCKERs

## Integration with CLAUDE.md Protocol

This skill implements the "Code Review Protocol" from CLAUDE.md:
- Pass 1 = Spec compliance check
- Pass 2-4 = Quality check (security, leftover debug, hardcoded values, regressions, error handling)
- Fix before deploying if either pass fails
