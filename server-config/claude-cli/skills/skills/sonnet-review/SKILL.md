---
name: sonnet-review
version: 1.0.0
description: |
  Sonnet 4.6 max-effort code review. Spawns Claude Sonnet 4.6 with max effort
  as an independent reviewer for bug, security, and logic analysis.
  Use when: "sonnet review", "sonnet code review", "review with sonnet",
  "second opinion sonnet", "sonnet check".
  Complements /codex (GPT-5.4) — use both for cross-model coverage.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# /sonnet-review -- Sonnet 4.6 Max-Effort Code Review

Spawns Claude Sonnet 4.6 at max effort as an independent code reviewer. Like /codex uses GPT-5.4, this uses Sonnet 4.6 — a different Claude model with different attention patterns. The value is a second Claude perspective with extended thinking enabled.

## Step 1: Get the Diff

Determine diff source from `$ARGUMENTS`:

```bash
# If user specified a commit SHA:
git diff <SHA>~1..<SHA>

# If user specified --base BRANCH:
git diff <BRANCH>...HEAD

# Default: check staged first, then unstaged, then last commit
git diff --cached          # staged
git diff                   # unstaged
git diff HEAD~1..HEAD      # last commit
```

If all empty: "Nothing to review. Stage changes or specify a commit."

Capture diff and stats:
```bash
DIFF_STAT=$(git diff --cached --stat)  # or appropriate variant
DIFF=$(git diff --cached)              # or appropriate variant
```

## Step 2: Security Guard (MANDATORY)

Before sending anything to an external `claude -p` process, scan the diff for secrets:

- API keys: `sk-`, `key-`, `token-`, `AKIA`, `AIza`
- Passwords: `password\s*[:=]`, `secret\s*[:=]`
- Private keys: `-----BEGIN.*PRIVATE KEY-----`
- Connection strings with credentials: `postgres://`, `mongodb://`, `redis://`
- .env content: any `+` lines from `*.env*` files
- JWTs: `eyJ` followed by base64

If ANY match found:
```
SONNET REVIEW ABORTED -- SECRETS DETECTED
==========================================
Found potential credentials in the diff. Refusing to send to subprocess.

[list what was found and which file/line]

Fix: Remove secrets from the diff, then re-run /sonnet-review.
```
**STOP. Do not proceed.**

## Step 3: Size Check

- **Under 500 lines**: Send as-is. Ideal for max-effort analysis.
- **500-2000 lines**: Send after stripping lock files, binary diffs, minified files, source maps.
- **2000-5000 lines**: Chunk by file. Prioritize: auth/security > core logic > config/tests.
  Run up to 3 parallel Sonnet reviews on separate chunks.
- **Over 5000 lines**: Warn user:
  ```
  Diff is very large (N lines). Sonnet max-effort works best on focused changes.
  Options:
  A) Review top 10 highest-risk files only
  B) Skip -- use /precheck instead for a quick scan
  ```
  Use AskUserQuestion to let them choose.

## Step 4: Run Sonnet Review

Write the diff to a temp file, then invoke Sonnet 4.6 in print mode:

```bash
TMPFILE=$(mktemp /tmp/sonnet-review-XXXXXX.diff)
echo "$DIFF" > "$TMPFILE"

# Single chunk (< 2000 lines)
timeout 300 claude -p --model sonnet --effort max \
  --bare --no-session-persistence \
  --allowedTools "Read" \
  --system-prompt "You are an expert code reviewer performing a thorough analysis. You have max effort (extended thinking) enabled — use it to reason deeply about edge cases, race conditions, and subtle bugs." \
  "Review this code diff. Report ONLY actionable findings:

1. BUGS — runtime failures, incorrect behavior, crashes
2. SECURITY — injection, auth bypass, data exposure, SSRF, XSS
3. LOGIC — wrong conditions, off-by-one, race conditions, state corruption
4. RESOURCE — memory leaks, unbounded growth, missing cleanup, OOM risk
5. DATA — data loss risks, corruption, inconsistent state

For each finding use this format:
SEVERITY: BUG | SECURITY | LOGIC | RESOURCE | DATA
FILE: <path>
LINE: <number or range>
ISSUE: <one sentence>
WHY: <impact in one sentence>
FIX: <suggested fix in one sentence>

Do NOT comment on: style, naming, formatting, refactoring suggestions, missing tests, documentation, type annotations.
If nothing actionable found, respond exactly: CLEAN

The diff:
$(cat "$TMPFILE")" > /tmp/sonnet-review-result.txt 2>&1

echo "EXIT=$?" >> /tmp/sonnet-review-result.txt
```

For chunked reviews (2000+ lines), run up to 3 parallel `claude -p` calls on separate file groups.

### Timeout Strategy
- Max effort Sonnet takes 1-4 minutes depending on diff size
- Use `timeout 300` (5 min) per chunk
- If timeout (EXIT=124): report partial results if any, note the timeout

## Step 5: Parse Results

Read the output file. Check exit code first:
```bash
tail -1 /tmp/sonnet-review-result.txt  # Should show EXIT=0
```

Parse findings:
- Look for structured `SEVERITY:` / `FILE:` / `LINE:` / `ISSUE:` markers
- If freeform: extract findings heuristically
- If "CLEAN": record zero findings
- Validate line numbers exist in the actual diff (discard hallucinated references)

## Step 6: Output Report

```
SONNET REVIEW | model: claude-sonnet-4-6 | effort: max
Target: [what was reviewed — commit SHA, staged changes, etc.]
Files: [N files, +X/-Y lines]
===========================================================

[P1] CRITICAL
  [SEVERITY] [file:line]
  Issue: [description]
  Impact: [why this matters]
  Fix: [suggestion]

[P2] IMPORTANT
  [SEVERITY] [file:line]
  Issue: [description]
  Impact: [why]
  Fix: [suggestion]

[P3] MINOR
  [file:line]
  Issue: [description]

---
VERDICT: [CLEAN | FIX N ISSUES (X critical, Y important)]
```

Priority mapping:
- **P1 CRITICAL**: BUG or SECURITY findings — must fix
- **P2 IMPORTANT**: LOGIC, RESOURCE, DATA findings — should fix
- **P3 MINOR**: lower-confidence findings — consider

If CLEAN:
```
SONNET REVIEW | model: claude-sonnet-4-6 | effort: max
Target: [target]
VERDICT: CLEAN -- no actionable issues found.
```

## Step 7: Cleanup

```bash
rm -f /tmp/sonnet-review-*.txt /tmp/sonnet-review-*.diff
```

## Rules

- **NEVER skip the secrets guard.** No exceptions.
- **NEVER send more than 5000 lines** in a single `claude -p` call. Chunk first.
- **NEVER auto-fix** based on findings. Present to user, let them decide.
- **Always use `--bare --no-session-persistence`** — the subprocess should not pollute session history or load hooks.
- **Always use `--model sonnet --effort max`** — that's the whole point of this skill.
- **Prefer specificity over volume.** 2 real findings beat 10 vague concerns.
- **Clean up temp files** after every run.
- **Report model and effort level** in the header so user knows what ran.

## When to Use

- Alongside `/codex` for cross-model coverage (GPT-5.4 + Sonnet 4.6)
- When you want deep extended-thinking analysis on tricky logic
- For security-sensitive changes where Sonnet's reasoning depth adds value
- As a lighter alternative to `/crossreview` when you only need one second opinion

## Comparison with Other Review Tools

| Tool | Model | Speed | Best For |
|------|-------|-------|----------|
| `/precheck` | Claude (current) | Fast | Quick scan before commit |
| `/sonnet-review` | Sonnet 4.6 max | 1-4 min | Deep analysis, subtle bugs |
| `/codex` | GPT-5.4 xhigh | 3-8 min | Cross-family perspective |
| `/crossreview` | Multiple models | 2-5 min | Blind spot detection |
| `code-reviewer` agent | Sonnet | Fast | Inline during conversation |
