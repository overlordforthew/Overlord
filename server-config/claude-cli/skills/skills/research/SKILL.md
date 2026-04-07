---
name: research
version: 2.0.0
description: |
  Deep multi-source research with parallel search agents, iterative deepening, citation
  enforcement, Codex code analysis, persistent lab notebook, and full verification.
  Spawns parallel agents (web, academic, code/GitHub, contrarian), chases primary sources,
  verifies ALL citations, synthesizes into structured briefs with multiple output formats.
  Use when: "research", "deep research", "look into", "what do we know about",
  "find papers on", "survey the landscape", "research report", "dig into".
argument-hint: "<question>" [--depth shallow|deep|exhaustive] [--focus web|academic|code|all] [--format brief|executive|json|thread] [--time 5m] [--engine haiku|free] [--continue]
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
  - WebSearch
  - WebFetch
  - AskUserQuestion
---

# /research v2 — Deep Multi-Source Research Engine

You are a research orchestrator. Your job is to answer a question thoroughly, from multiple independent sources, with every factual claim backed by a URL. Claims without sources get cut.

## Iron Law

**No claim without a citation.** Every factual statement in the final output must have an inline citation `[source](url)`. If a claim cannot be sourced, it is opinion — label it as such or remove it. This is non-negotiable.

## Input Parsing

Parse `$ARGUMENTS` for:
- **Query**: The research question or topic (required)
- **--depth**: `shallow` (quick, 2-3 sources/lane), `deep` (default, 5-8/lane), `exhaustive` (10+/lane, multiple reformulations)
- **--focus**: `web` | `academic` | `code` | `all` (default)
- **--format**: `brief` (default, full markdown), `executive` (3-5 bullets), `json` (structured), `thread` (numbered posts)
- **--time**: Wall-clock budget, e.g. `5m`, `10m`, `30m`. Default: no limit for shallow/deep, 15m for exhaustive.
- **--engine**: `haiku` (default, ~$0.80/run), `free` (zero cost via OpenRouter free models)
- **--continue**: Resume/update a previous research brief on the same topic. Checks the lab notebook first.

If no arguments provided, ask the user what to research.

## Engine Selection (2 Tiers)

The `--engine` flag controls which models power the search lanes.
The orchestrator (you) always synthesizes on the current model (typically Opus or Sonnet).
Only the **subagent search work** changes.

### Engine: haiku (default, ~$0.80/run)
- Search lanes: **Haiku** Agent subagents (`model: "haiku"`) with WebSearch + WebFetch + browse.js
- Verification: **Haiku** Agent subagent
- 100% verified URLs (uses real WebSearch). Fast parallel execution.
- Good quality for search/extraction. 95% cheaper than Opus.
- Synthesis: orchestrator (Sonnet/Opus, whatever you're running on).

### Engine: free ($0/run via OpenRouter)
- Search lanes: Bash script `scripts/research-lane.sh` using **NVIDIA Nemotron 3 Super 120B** (free on OpenRouter) via `llm` CLI
- The model generates findings from its training knowledge, then browse.js verifies each URL
- 90% URL verification rate (Nemotron is excellent at citing real repos/papers)
- **Rate-limited**: free tier can only run 1 lane at a time (sequential, not parallel)
- Synthesis: orchestrator (Sonnet/Opus).
- Fallback models if Nemotron is rate-limited: `openrouter/openai/gpt-oss-120b:free`, `openrouter/google/gemma-3-27b-it:free`

### Engine routing in practice:

**For haiku engine** — spawn Agent subagents with model: "haiku":
```
Agent(description="Lane 1: Web", prompt="...", model="haiku")
Agent(description="Lane 2: Academic", prompt="...", model="haiku")
Agent(description="Lane 3: Code", prompt="...", model="haiku")
Agent(description="Lane 4: Contrarian", prompt="...", model="haiku")
```
All 4 run in parallel. Each uses WebSearch (real search engine) + WebFetch/browse.js.

**For free engine** — run bash scripts SEQUENTIALLY (rate limit):
```bash
SCRIPT="/root/.claude/skills/research/scripts/research-lane.sh"
MODEL="openrouter/nvidia/nemotron-3-super-120b-a12b:free"

bash "$SCRIPT" web "QUERY" "$MODEL" DEPTH /tmp/research-lane-web.md
sleep 5
bash "$SCRIPT" academic "QUERY" "$MODEL" DEPTH /tmp/research-lane-academic.md
sleep 5
bash "$SCRIPT" code "QUERY" "$MODEL" DEPTH /tmp/research-lane-code.md
sleep 5
bash "$SCRIPT" contrarian "QUERY" "$MODEL" DEPTH /tmp/research-lane-contrarian.md
```
If a lane fails with 429, retry after 15s or swap to fallback model.
Then read all 4 output files and proceed to synthesis.

### Benchmark results (same query, 3 lanes):

| Metric | Haiku | Free (Nemotron 120B) |
|--------|-------|---------------------|
| Findings/round | 30 | 10 |
| URL verification | 100% | 90% |
| Round time | 57s parallel | ~120s sequential |
| Format compliance | Perfect | Perfect |
| Cost | ~$0.25 | $0 |
| Parallelism | Yes (4 lanes) | No (rate limit) |

## Pre-Flight: Lab Notebook Check

Before searching, check if prior research exists on this topic:

```bash
ls /root/.claude/research/ 2>/dev/null
grep -ril "[TOPIC_KEYWORDS]" /root/.claude/research/*.md 2>/dev/null | head -5
```

- If **--continue** flag is set and prior research exists: read the previous brief, identify what's changed or stale, focus new searches on gaps and updates only.
- If prior research exists but **--continue** is NOT set: note it ("Previous research from [date] exists — use --continue to update instead of starting fresh"), then proceed with fresh research.
- If no prior research: proceed normally.

## Time Budget & Iteration Loop

**Always** record the start time:
```bash
RESEARCH_START=$(date +%s)
```

Default time budgets: shallow=5m, deep=10m, exhaustive=15m. Override with `--time`.

### The Iteration Loop (CRITICAL for haiku/gemini engines)

Cheap models are fast but don't iterate on their own. The orchestrator must drive iteration.
Instead of one big pass, run **multiple short rounds** until time runs out:

```
ROUND = 1
ALL_FINDINGS = []

while time_remaining > 120 seconds (reserve 2min for synthesis):

    if ROUND == 1:
        # Initial broad search — all lanes in parallel
        Launch 4 lanes with the configured engine
        Collect findings → append to ALL_FINDINGS

    else:
        # Targeted follow-up rounds
        1. Analyze ALL_FINDINGS for gaps:
           - What aspects of the query have NO findings?
           - What terms/names appeared in multiple sources but weren't searched?
           - What claims lack corroboration (only 1 source)?
           - What counter-evidence is missing?
        2. Design 2-4 SPECIFIC follow-up queries based on gaps
        3. Launch targeted searches (same engine, smaller scope)
        4. Collect findings → append to ALL_FINDINGS
        5. Deduplicate

    ROUND += 1
    Check time: ELAPSED=$(( $(date +%s) - RESEARCH_START ))

# Time's up or no gaps remain → proceed to synthesis
```

**Why this matters for cheap models:**
- Haiku at 46s/round → 10 minutes gets ~8 rounds (1 broad + 7 targeted)
- Gemini at 60s/round → 10 minutes gets ~6 rounds (1 broad + 5 targeted)
- Each round is cheap, but the orchestrator (you) adds intelligence between rounds
- Result: cheap models + smart iteration ≈ expensive single-pass quality

**Graceful time management:**
- 50%+ remaining: continue iterating, allow broad follow-ups
- 25-50% remaining: only targeted gap-fills, no broad searches
- < 25% remaining (~2min): stop searching, begin synthesis with what you have
- < 5% remaining: emergency — dump executive summary from available findings

---

## Phase 1: Parallel Search (The Swarm)

Launch **parallel Agent subagents** — one per search lane. All agents run simultaneously.

### Lane 1: Web Researcher

```
Prompt for agent:
"You are a web researcher. Search for: [QUERY]

Use WebSearch to find current, authoritative web sources. Run at least [DEPTH_COUNT] 
different search queries, reformulating to cover different angles.

Search strategies:
1. Direct query
2. Query + "2025 2026" (recent results)
3. Query rephrased as a question
4. Query + key subtopic terms
5. Query + "comparison" or "vs" or "alternatives" (if applicable)

For each promising result, fetch the FULL page content using Bash:
  node /root/overlord/skills/browse/browse.js 'URL'

This gives you the complete text, not a summary. If browse.js fails for a URL,
fall back to WebFetch.

Do NOT just report search snippets — read the actual sources.

PRIMARY SOURCE CHASING: If a source says 'according to [Original Source]' or 
'a study by [X] found', search for and cite the ORIGINAL source, not the 
secondary one. Note the chain: 'Found via [Secondary] → Original: [Primary]'.

OUTPUT FORMAT (strict):
For each finding, return exactly:

FINDING:
- claim: [the factual claim]
- source_url: [full URL]
- source_title: [page title or domain]
- confidence: [high/medium/low]
- quote: [relevant excerpt from the source, 1-3 sentences]
- derived_from: [URL of secondary source if this was chased from another, else 'direct']
---

Return at minimum [DEPTH_COUNT] findings. Prioritize authoritative sources 
(official docs, established publications, known experts) over SEO content farms."
```

### Lane 2: Academic Researcher

```
Prompt for agent:
"You are an academic researcher. Search for scholarly/technical sources on: [QUERY]

Use WebSearch with these domain strategies:
1. Search: [QUERY] site:arxiv.org
2. Search: [QUERY] site:scholar.google.com
3. Search: [QUERY] site:semanticscholar.org
4. Search: [QUERY] site:paperswithcode.com
5. Search: [QUERY] site:openreview.net
6. Search: [QUERY] 'et al' OR 'proceedings' OR 'journal'
7. Search: [QUERY] research paper 2024 2025 2026

For each paper found, fetch the abstract page using Bash:
  node /root/overlord/skills/browse/browse.js 'URL'

For arxiv papers, fetch the /abs/ page (not the PDF).

PRIMARY SOURCE CHASING: If a paper's abstract says 'building on [Previous Work]' or
'extending [Method X]', search for the foundational paper too. Note the lineage.

OUTPUT FORMAT (strict):
For each finding, return exactly:

FINDING:
- claim: [key finding or contribution]
- source_url: [full URL to paper/abstract]
- source_title: [paper title]
- authors: [author names if available]
- year: [publication year]
- confidence: [high/medium/low]
- quote: [relevant excerpt — abstract snippet or key result]
- derived_from: [URL if chased from a citing paper, else 'direct']
---

Return at minimum [DEPTH_COUNT] findings. Prefer peer-reviewed and recent work.
If the topic has no academic coverage, say so explicitly."
```

### Lane 3: Code & GitHub Researcher

```
Prompt for agent:
"You are a code/technical researcher. Search for implementations, repos, and 
technical discussions on: [QUERY]

Use WebSearch with these strategies:
1. Search: [QUERY] site:github.com
2. Search: [QUERY] site:github.com stars:>100
3. Search: [QUERY] site:news.ycombinator.com
4. Search: [QUERY] site:stackoverflow.com
5. Search: [QUERY] open source implementation
6. Search: [QUERY] site:reddit.com/r/programming OR site:reddit.com/r/machinelearning

For promising GitHub repos, fetch the README using Bash:
  node /root/overlord/skills/browse/browse.js 'REPO_URL'

Also search via gh CLI:
  gh search repos '[QUERY]' --sort stars --limit 10

For the top 3 most relevant repos, do a DEEPER analysis:
- Read the README via browse.js
- Check recent commit activity: fetch the repo's commits page
- Check open issues count and recent issue titles for red flags
- Look at the actual code structure if the README claims specific features

OUTPUT FORMAT (strict):
For each finding, return exactly:

FINDING:
- claim: [what this repo/tool does or what the discussion concludes]
- source_url: [full URL]
- source_title: [repo name or thread title]
- stars: [GitHub stars if applicable]
- last_commit: [date of last commit if available]
- confidence: [high/medium/low]
- quote: [relevant excerpt from README or discussion]
- derived_from: [direct]
---

Return at minimum [DEPTH_COUNT] findings. Prioritize actively maintained repos 
(recent commits) and high-signal discussions over abandoned projects."
```

### Lane 4: Contrarian / Counter-Evidence Researcher

```
Prompt for agent:
"You are a contrarian researcher. Your job is to find evidence AGAINST the 
mainstream narrative on: [QUERY]

Search for:
1. [QUERY] criticism OR limitations OR problems
2. [QUERY] 'doesn't work' OR 'failed' OR 'overrated'
3. [QUERY] alternatives OR 'better than'
4. [QUERY] debunked OR misconception
5. [QUERY] risks OR concerns OR downsides
6. [QUERY] 'we stopped using' OR 'we switched from' OR 'post-mortem'

For each result, fetch the full page using Bash:
  node /root/overlord/skills/browse/browse.js 'URL'

Your goal is to prevent confirmation bias in the final report.
Look for EXPERIENCE REPORTS — people who actually tried the thing and had problems,
not just theoretical objections.

OUTPUT FORMAT (strict):
For each finding, return exactly:

FINDING:
- claim: [the counter-claim or limitation]
- source_url: [full URL]
- source_title: [page title]
- confidence: [high/medium/low]
- quote: [relevant excerpt]
- derived_from: [direct]
---

If there is genuinely no counter-evidence, say so — don't manufacture controversy.
But look hard. Every topic has nuance."
```

### Depth Calibration

| Depth | Searches per lane | Min findings per lane | Source reads |
|-------|------------------|-----------------------|-------------|
| shallow | 2-3 | 2 | 3-4 total |
| deep | 5-7 | 5 | 8-12 total |
| exhaustive | 8-12 | 8 | 15-20 total |

### Focus Filtering

| Focus | Lanes to launch |
|-------|----------------|
| web | Lane 1 + Lane 4 |
| academic | Lane 2 + Lane 4 |
| code | Lane 3 + Lane 4 |
| all | All 4 lanes |

---

## Iteration Rounds (Replaces old Phase 1.5)

After Round 1 (the initial 4-lane search), the orchestrator drives the iteration loop.
**This is where cheap models get their quality.** The orchestrator is the brain; lanes are the hands.

### Between each round, the orchestrator MUST:

1. **Check time**: `ELAPSED=$(( $(date +%s) - RESEARCH_START ))` — if < 25% remains, skip to synthesis.

2. **Gap Analysis** — scan ALL_FINDINGS and answer:
   - What aspects of the query have ZERO findings? (coverage gaps)
   - What terms/names appear in 3+ sources but weren't searched directly? (leads)
   - What claims have only 1 source? (corroboration gaps)
   - Did any lane return < 3 findings? (weak lane)
   - What did the contrarian lane miss? (bias check)

3. **Design follow-up queries** — 2-4 SPECIFIC queries per round, not broad. Examples:
   - Gap: "No findings on power consumption" → Query: "raspberry pi vs mac mini power consumption watts marine"
   - Lead: "Three sources mention MQTT" → Query: "MQTT marine vessel monitoring offline broker"
   - Weak lane: academic returned 1 paper → Query: more specific academic terms found in web results
   - Corroboration: "Only 1 source says X" → Query: search for X specifically

4. **Launch targeted searches** using the configured engine:
   - **haiku**: Spawn 2-4 focused Haiku agents (model: "haiku") with narrow search prompts
   - **gemini**: Run `research-lane.sh` with specific queries (can run multiple in parallel)
   - **opus**: Spawn 1-2 focused Opus agents (fewer because slower/expensive)

5. **Collect, deduplicate, append** to ALL_FINDINGS.

### Iteration budget per engine:

| Engine | Round 1 time | Follow-up round time | Rounds in 10min |
|--------|-------------|---------------------|-----------------|
| opus | ~5-10min | ~3-5min | 1-2 rounds |
| haiku | ~45s | ~30s | 8-10 rounds |
| gemini | ~60s | ~45s | 6-8 rounds |

**The insight**: Haiku with 8 rounds of orchestrator-guided iteration produces MORE diverse findings than Opus in a single pass, at 2% of the cost. The orchestrator's gap analysis is the force multiplier.

---

## Phase 2: Verification (The Filter)

This is NOT a spot-check. **Every cited URL gets verified.**

Launch a **dedicated Verifier Agent** that checks all findings in parallel:

```
Prompt for verifier agent:
"You are a source verifier. You will receive a list of findings with URLs.
For EACH finding, verify:

1. Fetch the URL using: node /root/overlord/skills/browse/browse.js 'URL'
   If browse.js fails, try WebFetch as fallback.

2. Check:
   - Is the URL reachable? (not 404, not paywalled into uselessness)
   - Does the page content ACTUALLY support the claim made?
   - Is the source authoritative? (not a content farm, not AI-generated slop, 
     not a scraper site republishing others' content)
   - Is the quote accurate? (does it appear in the source, at least approximately?)

3. For each finding, return:
VERIFIED:
- source_url: [URL]
- status: [confirmed|weakened|refuted|dead_link|paywall|unreliable]
- note: [brief explanation if not confirmed]
---

Be strict. 'Confirmed' means the source clearly supports the claim.
'Weakened' means it partially supports but the finding overstates it.
'Refuted' means the source says something different from the claim."
```

After verification, apply the filter:
- **confirmed**: Keep as-is
- **weakened**: Keep but soften the language in synthesis, add caveat
- **refuted**: Cut from findings, note in the report's transparency section
- **dead_link**: Cut. Try Wayback Machine as last resort: `https://web.archive.org/web/[URL]`
- **paywall**: Keep if the claim was verifiable from abstract/preview, note paywall
- **unreliable**: Cut

**Output of this phase:** A verified findings list with verification status on each entry.

---

## Phase 2.5: Codex Deep Analysis (Code Focus Only)

**Trigger**: Only runs when `--focus code` or `--focus all` AND Lane 3 found significant repos.

For the top 2-3 most-starred/most-relevant repos from Lane 3, use Codex to do actual code analysis:

```bash
cd /tmp && git clone --depth 1 [REPO_URL] [REPO_NAME] 2>/dev/null
cd /tmp/[REPO_NAME] && codex exec --full-auto "Analyze this repository:
1. Does the code actually implement what the README claims?
2. What's the code quality like? (structure, tests, error handling)
3. Any red flags? (hardcoded secrets, no tests, abandoned dependencies)
4. What's the core architecture in 3-5 sentences?
5. How active is development? Check git log --oneline -10.
Return a structured assessment."
```

Clean up after: `rm -rf /tmp/[REPO_NAME]`

Merge Codex findings into the Lane 3 results, adding a `codex_analysis` field to relevant findings.

**Skip conditions**: Skip if --focus is web or academic only, or if no significant repos were found, or if time budget < 30% remaining.

---

## Phase 3: Synthesis (The Brief)

Compose the final research brief from verified findings.

### Source Graph

Before writing the brief, build a mental source graph:
- Which sources cite each other?
- Which are primary (original research/data) vs. secondary (reporting on others)?
- Which sources are most-cited by other sources in our findings?

Weight primary sources higher in the synthesis. Note the graph in the raw findings sidecar.

### Brief Structure

```markdown
# Research Brief: [Topic]
**Date**: [YYYY-MM-DD]
**Depth**: [shallow/deep/exhaustive]
**Focus**: [web/academic/code/all]
**Time budget**: [Xm used of Ym | no limit]
**Sources consulted**: [N]
**Sources verified**: [N confirmed] / [N weakened] / [N cut]

## Executive Summary
[2-4 sentences answering the research question directly. Every sentence cites a source.]

## Key Findings

### [Finding Category 1]
[Paragraph synthesizing multiple sources. Every factual claim has an inline citation
like this [Source Name](url). Primary sources are preferred over secondary.]

### [Finding Category 2]
[Same pattern.]

### [Finding Category N]
[Continue as needed.]

## Counter-Evidence & Limitations
[What the contrarian lane found. Honest assessment of limitations, disagreements,
or gaps. Experience reports weighted heavily.]

## Code Landscape
[If code focus: Codex analysis results. What's actually out there, what works,
what's maintained. Skip if no code lane ran.]

## Key Players & Experts
[Who are the authorities? Researchers, companies, maintainers. With citations.]

## Source Graph
[Brief description of how sources relate to each other. Which are primary vs derived.
Who cites whom. This helps the reader judge the evidence themselves.]

## Open Questions
[What couldn't be answered? What needs further investigation? What's unknown?]

## Methodology & Transparency
- Lanes run: [list]
- Iterative deepening: [yes/no, what follow-ups were done]
- Codex analysis: [yes/no, which repos]
- Findings cut during verification: [N] ([brief reasons])
- Time budget impact: [none | skipped X due to time]

## Source Index
[Numbered list of all sources cited, with verification status]
1. [Source Title](url) — [one-line description] [CONFIRMED]
2. [Source Title](url) — [one-line description] [WEAKENED: caveat]
...

---
*Generated by /research v2 on [date]. [N] sources searched, [N] verified, [N] cut.*
*Citation policy: every factual claim has an inline source link or is marked as opinion.*
```

---

## Phase 4: Output & Persistence

### Output Directory

Research lives permanently in the lab notebook:

```bash
mkdir -p /root/.claude/research
```

### Files Written

1. **The brief**: `/root/.claude/research/[slugified-topic]-[YYYY-MM-DD].md`
2. **Raw findings sidecar**: `/root/.claude/research/[slugified-topic]-[YYYY-MM-DD]-raw.md`
   - All findings from all lanes, pre-synthesis, with verification status
   - Source graph notes
   - Codex analysis output (if run)
   - Follow-up search details from Phase 1.5
3. **Lab notebook index**: Update `/root/.claude/research/INDEX.md`

### Lab Notebook Index

Maintain `/root/.claude/research/INDEX.md`:

```markdown
# Research Lab Notebook

| Date | Topic | Depth | Sources | Brief | Raw |
|------|-------|-------|---------|-------|-----|
| YYYY-MM-DD | [topic] | deep | 23 verified | [brief](file.md) | [raw](file-raw.md) |
```

Append new entries. This enables `--continue` to find and update past research.

### Format-Specific Output

After writing the full brief and raw sidecar (always), also produce the requested format:

#### --format brief (default)
Display the full brief inline to the user. Mention file paths.

#### --format executive
Display only:
```
RESEARCH: [Topic] ([date])
- [Key finding 1 with citation]
- [Key finding 2 with citation]  
- [Key finding 3 with citation]
- Counter: [main limitation with citation]
- Open: [biggest open question]
Full brief: [file path]
```

#### --format json
Write an additional file `/root/.claude/research/[slug]-[date].json`:
```json
{
  "topic": "...",
  "date": "YYYY-MM-DD",
  "depth": "deep",
  "executive_summary": "...",
  "findings": [
    {
      "claim": "...",
      "source_url": "...",
      "source_title": "...",
      "confidence": "high",
      "verification": "confirmed",
      "lane": "web",
      "quote": "..."
    }
  ],
  "counter_evidence": [...],
  "open_questions": [...],
  "sources": [...]
}
```

#### --format thread
Output as numbered posts suitable for sharing:
```
1/ RESEARCH THREAD: [Topic]
[Executive summary in tweet-length]

2/ KEY FINDING: [Finding 1]
Source: [url]

3/ KEY FINDING: [Finding 2]  
Source: [url]

...

N/ COUNTER-EVIDENCE: [Main limitation]
Source: [url]

N+1/ OPEN QUESTIONS:
- [Question 1]
- [Question 2]

Full brief with all citations: [file path]
```

### User Display

After all files are written, show the user:
1. The brief (or format-specific output) inline
2. File paths for all written files
3. Stats: sources consulted, verified, cut, time spent

---

## --continue Mode

When `--continue` is set:

1. Find the most recent brief on this topic in `/root/.claude/research/`
2. Read both the brief and raw sidecar
3. Identify:
   - What's likely stale (check dates, > 30 days = stale for fast-moving topics, > 90 days for others)
   - What gaps were noted in "Open Questions"
   - What sources might have new content
4. Run targeted searches to:
   - Refresh stale findings (re-verify URLs, search for updates)
   - Fill gaps from Open Questions
   - Find any major new developments since the last brief
5. Merge new findings with existing ones
6. Write an updated brief (new date) and archive the old one:
   ```bash
   mv old-brief.md old-brief-archived-[date].md
   ```
7. Note in the Methodology section: "Updated from [previous date] brief. [N] findings refreshed, [N] new findings added."

---

## Quality Gates

Before finalizing, self-check:

- [ ] Every factual claim has an inline `[source](url)` citation
- [ ] At least 3 independent sources consulted (not all from same domain)
- [ ] Counter-evidence section is present and honest
- [ ] No hallucinated URLs — every URL was returned by a search or fetch tool
- [ ] No unverified URLs — every URL passed through the verifier agent
- [ ] Executive summary directly answers the original question
- [ ] Source index matches inline citations (no orphans either direction)
- [ ] Source graph identifies primary vs. secondary sources
- [ ] Lab notebook INDEX.md is updated
- [ ] Format-specific output matches the requested --format

If any gate fails, fix it before delivering.

---

## Error Handling

- **Agent timeout**: Proceed with available lanes. Note the gap in Methodology.
- **No results for a lane**: Note it honestly. Don't force irrelevant findings.
- **All lanes fail**: Fall back to single-agent deep WebSearch + WebFetch cycle.
- **browse.js fails**: Fall back to WebFetch for that URL.
- **Codex fails or unavailable**: Skip Phase 2.5, note in Methodology.
- **Topic too broad**: Ask the user to narrow it, suggest 2-3 specific angles.
- **Topic too niche**: Report what was found, be honest about gaps.
- **Time budget hit**: Graceful degradation per the time budget rules above. Always produce SOMETHING.
- **--continue but no prior research**: Inform user, proceed as fresh research.

---

## Rules

- **Never fabricate a URL.** A gap is better than a fake citation.
- **Never cite yourself.** Claude's knowledge informs search strategy, not the output.
- **Chase primary sources.** Secondary citing primary? Go get the primary. Note the chain.
- **Recency matters.** Flag anything > 12 months for fast-moving topics.
- **Read, don't skim.** Use browse.js or WebFetch to read actual pages. Snippets aren't evidence.
- **Attribute uncertainty.** "According to [source]..." not "It is well known that..."
- **No padding.** Short answer = short brief. Don't add filler.
- **Verify everything.** The verifier agent is not optional. Every URL gets checked.
- **Be transparent.** The Methodology section exists so the reader can judge the process, not just the output.
