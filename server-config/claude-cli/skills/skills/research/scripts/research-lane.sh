#!/usr/bin/env bash
# research-lane.sh — Run a research lane using llm CLI + browse.js verification
# Usage: research-lane.sh <lane> <query> <model> <depth_count> <output_file>
#
# Architecture: Ask the LLM to generate findings from its knowledge, then
# verify each URL exists via browse.js. Cut dead URLs.
# This avoids dependency on external search APIs.

set -euo pipefail

LANE="${1:?Usage: research-lane.sh <lane> <query> <model> <depth_count> <output_file>}"
QUERY="${2:?Missing query}"
MODEL="${3:-gemini/gemini-2.5-flash}"
DEPTH_COUNT="${4:-5}"
OUTPUT_FILE="${5:?Missing output file}"
BROWSE="/root/overlord/skills/browse/browse.js"

# Lane-specific system prompts
case "$LANE" in
    web)
        SYSTEM_PROMPT="You are a web researcher with extensive knowledge of online resources.
Research this topic: $QUERY

Generate $DEPTH_COUNT factual findings from your knowledge of authoritative web sources.
For each finding, cite a REAL URL that you are confident exists.
Prefer: official documentation, established publications, known tech blogs, product pages.
Avoid: generic listicles, SEO farms, made-up URLs.

OUTPUT FORMAT (strict — follow EXACTLY):
FINDING:
- claim: [factual claim]
- source_url: [real URL you are confident exists]
- source_title: [page title]
- confidence: [high/medium/low]
- quote: [plausible excerpt supporting the claim]
- derived_from: direct
---

CRITICAL: Only cite URLs you believe actually exist. Every URL will be verified.
If unsure about a URL, use a well-known domain you're confident about."
        ;;
    academic)
        SYSTEM_PROMPT="You are an academic researcher with deep knowledge of published papers.
Research this topic: $QUERY

Generate $DEPTH_COUNT findings from academic papers you know about.
Cite REAL paper URLs (arxiv.org/abs/..., doi.org/..., pmc.ncbi.nlm.nih.gov/...).
Include authors, year, and key findings.

OUTPUT FORMAT (strict):
FINDING:
- claim: [key research finding]
- source_url: [real URL to paper — arxiv, doi, PMC]
- source_title: [paper title]
- authors: [if known]
- year: [publication year]
- confidence: [high/medium/low]
- quote: [excerpt from abstract or key result]
- derived_from: direct
---

CRITICAL: Only cite papers you are confident exist with real arxiv/doi/PMC IDs."
        ;;
    code)
        SYSTEM_PROMPT="You are a code/technical researcher with extensive GitHub knowledge.
Research implementations and repos for: $QUERY

Generate $DEPTH_COUNT findings about real GitHub repos, tools, and implementations.
Cite REAL GitHub URLs you are confident exist.

OUTPUT FORMAT (strict):
FINDING:
- claim: [what the repo/tool does]
- source_url: [real GitHub URL]
- source_title: [repo name]
- stars: [approximate if known]
- confidence: [high/medium/low]
- quote: [from README or description]
- derived_from: direct
---

CRITICAL: Only cite repos you are confident exist. Prefer well-known, high-star repos."
        ;;
    contrarian)
        SYSTEM_PROMPT="You are a contrarian researcher looking for problems and limitations.
Find evidence AGAINST: $QUERY

Generate $DEPTH_COUNT findings about failures, limitations, criticisms.
Focus on experience reports from people who tried things.
Cite REAL URLs from forums, blog posts, GitHub issues, articles.

OUTPUT FORMAT (strict):
FINDING:
- claim: [counter-claim or limitation]
- source_url: [real URL]
- source_title: [page title]
- confidence: [high/medium/low]
- quote: [relevant excerpt]
- derived_from: direct
---

CRITICAL: Only cite URLs you are confident exist. GitHub issues, HN threads, blog posts."
        ;;
esac

# Step 1: Generate findings via LLM
RAW_FINDINGS=$(llm -m "$MODEL" "$SYSTEM_PROMPT" 2>&1)

if [ -z "$RAW_FINDINGS" ]; then
    echo "ERROR: LLM returned empty response for lane=$LANE" > "$OUTPUT_FILE"
    exit 1
fi

# Step 2: Extract URLs and verify via browse.js
# Parse URLs from findings
URLS=$(echo "$RAW_FINDINGS" | grep -oP '(?<=source_url: )https?://[^\s]+' | head -"$DEPTH_COUNT")

VERIFIED_FINDINGS="$RAW_FINDINGS"
DEAD_COUNT=0

while IFS= read -r url; do
    [ -z "$url" ] && continue
    # Quick URL check via browse.js (3s timeout) or curl HEAD
    if [ -f "$BROWSE" ]; then
        STATUS=$(timeout 8 node "$BROWSE" "$url" 2>/dev/null | head -c 200) || STATUS=""
    else
        STATUS=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null) || STATUS=""
    fi

    if [ -z "$STATUS" ] || [ "$STATUS" = "000" ] || [ "$STATUS" = "404" ]; then
        DEAD_COUNT=$((DEAD_COUNT + 1))
        # Don't remove — mark as unverified in output
        VERIFIED_FINDINGS=$(echo "$VERIFIED_FINDINGS" | sed "s|$url|$url [UNVERIFIED]|g")
    fi
done <<< "$URLS"

# Step 3: Write output
echo "$VERIFIED_FINDINGS" > "$OUTPUT_FILE"

FINDING_COUNT=$(grep -c "^FINDING:" "$OUTPUT_FILE" 2>/dev/null || echo 0)
echo ""
echo "Lane $LANE complete: $FINDING_COUNT findings ($DEAD_COUNT unverified URLs) -> $OUTPUT_FILE"
