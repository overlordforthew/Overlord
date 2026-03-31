---
name: crossreview
version: 1.0.0
description: |
  Cross-model adversarial code review. Sends diff to 2 non-Claude models via llm CLI,
  then synthesizes disagreements to surface blind spots Claude would miss.
  Use when: "crossreview", "cross review", "adversarial review", "second opinion",
  "blind spot check", "review with other models", "external review".
  Run after /precheck, before /ship-it.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - AskUserQuestion
---

# /crossreview -- Cross-Model Adversarial Code Review

Sends the diff to non-Claude models for independent review, then compares findings to catch blind spots. The value is in what *other* models see that Claude doesn't.

## Step 1: Get the Diff

Determine diff source from invocation context:

```bash
# If user specified --commit SHA or reviewing a specific commit:
git diff <SHA>~1..<SHA>

# If user specified --base BRANCH:
git diff <BRANCH>...HEAD

# Default: check staged first
git diff --cached

# If nothing staged, check unstaged:
git diff
```

If empty: "Nothing to review. Stage changes or specify a commit."

Capture the diff and stats:
```bash
DIFF_STAT=$(git diff --cached --stat)  # or appropriate variant
DIFF=$(git diff --cached)              # or appropriate variant
DIFF_LINES=$(echo "$DIFF" | wc -l)
DIFF_FILES=$(echo "$DIFF_STAT" | tail -1)
```

## Step 2: Security Guard (MANDATORY -- DO NOT SKIP)

Before sending ANY content to external models, scan the diff for secrets. These are third-party services -- credentials must never leave this machine.

Scan the raw diff text for:
- API keys: patterns like `sk-`, `key-`, `token-`, `AKIA`, `AIza`
- Passwords: `password\s*[:=]`, `passwd`, `secret\s*[:=]`
- Private keys: `-----BEGIN.*PRIVATE KEY-----`
- Connection strings: `postgres://`, `mongodb://`, `redis://` with credentials
- .env file content: any `+` lines from files matching `*.env*`
- Webhook URLs with embedded tokens
- JWT tokens: `eyJ` followed by base64

If ANY match is found:

```
CROSSREVIEW ABORTED -- SECRETS DETECTED
========================================
Found potential credentials in the diff. Refusing to send to external models.

[list what was found and which file/line]

Fix: Remove secrets from the diff, then re-run /crossreview.
Tip: Run /precheck first -- it catches these too.
```

**STOP HERE. Do not proceed to Step 3.**

## Step 3: Clean the Diff

Strip noise that wastes external model tokens and produces irrelevant findings:

**Remove entirely:**
- Binary file diffs (`Binary files ... differ`)
- Lock files: `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- Generated/build output: files in `dist/`, `build/`, `node_modules/`, `.next/`
- Minified files: `*.min.js`, `*.min.css`
- Source maps: `*.map`

**Size handling:**
- **Under 200 lines after cleaning**: Send as-is. No chunking needed.
- **200-800 lines**: Send after cleaning. Should fit in free model context windows.
- **800-3000 lines**: Chunk by file. Prioritize:
  1. Files touching auth, security, database, API endpoints
  2. Core logic files (under `src/`, `lib/`, `app/`, root `.js`/`.ts` files)
  3. Config files, tests, utilities
  4. Cap at 10 file-chunks per model
- **Over 3000 lines or 50+ files**: Warn user:
  ```
  Diff is very large (N files, N lines). Cross-model review works best on focused changes.
  Options:
  A) Review top 10 highest-risk files only
  B) Skip -- use /precheck instead
  ```
  Use AskUserQuestion to let them choose.

## Step 4: Send to External Models

### Review Channels (Priority Order)

**Channel 1: Codex CLI (PRIMARY — $20/mo plan, always use)**
```bash
codex review --commit HEAD 2>&1
# Or for staged/unstaged: codex review --uncommitted 2>&1
```
Codex uses GPT models via ChatGPT auth. This is the trusted external reviewer — always run it.

**Channel 2: Free model via `llm` CLI (SECONDARY — one model for diversity)**
Try models in order, use the first that responds within 60 seconds:

| # | Model ID | Why |
|---|----------|-----|
| 1 | `openrouter/nvidia/nemotron-3-super-120b-a12b:free` | 120B, reliable, strong reasoning |
| 2 | `openrouter/z-ai/glm-4.5-air:free` | Zhipu/GLM architecture, diverse perspective |
| 3 | `openrouter/arcee-ai/trinity-large-preview:free` | Different training mix |
| 4 | `openrouter/stepfun/step-3.5-flash:free` | Fast, reliable |
| 5 | `openrouter/openrouter/free` | Auto-routing fallback (always works) |

The free model provides a third perspective. If rate-limited, skip — Codex alone is sufficient.

### Review Prompt
Write the diff to a temp file, then pipe with this prompt:

```bash
TMPFILE=$(mktemp /tmp/crossreview-XXXXXX.txt)
cat > "$TMPFILE" << 'PROMPT_END'
You are reviewing a code diff. Report ONLY:
1. Bugs that would cause runtime failures or incorrect behavior
2. Security vulnerabilities (injection, auth bypass, data exposure)
3. Logic errors (wrong condition, off-by-one, race condition)
4. Resource issues (leaks, unbounded growth, missing cleanup)

Do NOT comment on: style, naming, formatting, refactoring suggestions, missing tests, documentation.

For each finding, use this exact format:
FILE: <path>
LINE: <number or range>
SEVERITY: BUG | SECURITY | LOGIC | RESOURCE
ISSUE: <one sentence>
WHY: <impact in one sentence>

If nothing found, respond with exactly: CLEAN
PROMPT_END

echo "" >> "$TMPFILE"
echo "--- DIFF ---" >> "$TMPFILE"
echo "$CLEAN_DIFF" >> "$TMPFILE"
```

### Dispatch (Parallel)
Run Codex and one free model in parallel. Codex is mandatory; the free model is best-effort.

```bash
# Codex (PRIMARY — always run)
codex review --commit HEAD > /tmp/crossreview-codex.txt 2>&1 &
PID_CODEX=$!

# Free model (SECONDARY — one model for diversity)
timeout 60 cat "$TMPFILE" | llm -m MODEL_ID 2>/tmp/crossreview-free-err.txt > /tmp/crossreview-free.txt &
PID_FREE=$!

# Wait for both
wait $PID_CODEX $PID_FREE
```

For staged/unstaged changes (no commit yet), use `codex review --uncommitted` instead.

### Fallback Logic
- **Codex succeeded**: Proceed with synthesis even if the free model failed. Codex is the trusted reviewer.
- **Codex failed**: Try `codex review` once more. If still failing, proceed with free model only and note reduced confidence.
- **Both failed**: Fall back to Claude-only review with a clear warning:

```
WARNING: All external models unavailable.
Blind spot detection unavailable. This is a Claude-only review.
```

### Cleanup
```bash
rm -f /tmp/crossreview-*.txt
```

## Step 5: Adversarial Synthesis

Now Claude reads all external model responses and the diff itself. This is where the skill's value lives.

### Parse External Responses
For each model response:
1. Look for structured `FILE:` / `LINE:` / `SEVERITY:` / `ISSUE:` markers
2. If the model returned freeform text: extract findings heuristically (look for file references, line numbers, bug descriptions)
3. If the model returned "CLEAN": record zero findings
4. If the model returned nonsense/refusal/off-topic: mark as "model failed, excluded from synthesis"

### Validate Findings
For each extracted finding:
- **Check line numbers**: Does the referenced line exist in the actual diff? Discard findings with hallucinated line numbers (outside the diff range)
- **Check file paths**: Does the referenced file appear in the diff? Discard findings about files not in the diff
- **Filter noise**: Discard generic advice ("consider adding error handling"), style comments ("variable name could be better"), and test suggestions ("add unit tests for this")

### Categorize
Review the diff yourself, then compare your assessment against external findings:

- **BLIND SPOT CATCHES**: An external model flagged a real issue (BUG or SECURITY severity) in an area you would NOT have flagged. These are the primary output of this skill.
- **CONSENSUS**: Both you and an external model (or multiple external models) flag the same issue. High confidence.
- **CONFLICTS**: An external model says something is a bug, but you assess it as fine (or vice versa). Flag for human judgment with both perspectives.

Do NOT include a "Claude-only findings" section. This skill is about external perspectives, not another Claude review. If you find something the external models missed, add it under consensus with a note.

## Step 6: Output Report

```
CROSSREVIEW -- [branch] -- [N files, +X/-Y lines]
====================================================
Models: [model1-short-name], [model2-short-name], Codex
Failed: [model3 (reason)] or "none"

BLIND SPOT CATCHES
------------------
[SEVERITY] [file:line] (caught by: model-short-name)
  Issue: [description]
  Impact: [why this matters]

CONSENSUS FINDINGS
------------------
[SEVERITY] [file:line] (agreed: N sources)
  Issue: [description]
  Fix: [suggestion if obvious]

CONFLICTS
---------
[file:line]
  [model-short-name] says: [their finding]
  Assessment: [your judgment -- is this real or noise?]

SUMMARY: N blind spots | N consensus | N conflicts
VERDICT: [CLEAN | FIX N ISSUES | N BLIND SPOTS FOUND]
```

If all models returned CLEAN and you agree:
```
CROSSREVIEW -- [branch] -- [N files, +X/-Y lines]
====================================================
Models: [model1], [model2], Codex
VERDICT: CLEAN -- no issues found across N independent reviewers.
```

## Rules

- **NEVER skip the secrets guard.** No exceptions. If in doubt, abort.
- **NEVER send more than 4000 lines** to a single external model call. Chunk first.
- **NEVER auto-fix** based on external model suggestions. Present findings, let the human decide.
- **Prefer specificity over volume.** 2 real findings beat 10 generic suggestions.
- **Trust consensus, investigate conflicts, highlight blind spots.** That's the priority order for the human's attention.
- **If fewer than 2 external models responded:** State this clearly in the header. The review has lower confidence.
- **Clean up temp files** after every run. Don't leave diffs on disk.
