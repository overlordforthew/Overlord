#!/bin/bash
# token-dashboard.sh — Weekly token usage report + HTML dashboard
# Runs Sundays at 8 AM. Generates:
#   1. WhatsApp summary (~3500 chars) sent via /api/send
#   2. Full markdown report → /root/overlord/data/token-report.md
#   3. HTML dashboard → /root/overlord/data/token-dashboard.html

set -euo pipefail

DATA_DIR="/root/overlord/data"
TOKEN_DATA="$DATA_DIR/token-usage.json"
REPORT_MD="$DATA_DIR/token-report.md"
DASHBOARD_HTML="$DATA_DIR/token-dashboard.html"
TODAY=$(date +%Y-%m-%d)
WEEK_START=$(date -d "7 days ago" +%Y-%m-%d)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

WEBHOOK_TOKEN="${WEBHOOK_TOKEN:-$(grep WEBHOOK_TOKEN /root/overlord/.env 2>/dev/null | cut -d= -f2)}"
SEND_URL="http://localhost:3001/api/send"

echo "=== Token Dashboard: $TODAY ==="

# Run aggregation first to ensure fresh data
"$SCRIPT_DIR/token-aggregate.sh" 2>&1 || echo "WARN: aggregation had errors"

# ─── Generate all three outputs with Python ───
python3 << 'PYEOF'
import json, os, glob
from datetime import datetime, timedelta
from math import ceil
from pathlib import Path

DATA_DIR = "/root/overlord/data"
TOKEN_DATA = f"{DATA_DIR}/token-usage.json"
REPORT_MD = f"{DATA_DIR}/token-report.md"
DASHBOARD_HTML = f"{DATA_DIR}/token-dashboard.html"
TODAY = datetime.now().strftime("%Y-%m-%d")
WEEK_START = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d")

# ═══════════════════════════════════════════
# Load token data
# ═══════════════════════════════════════════
try:
    with open(TOKEN_DATA) as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    data = {"days": {}}

# Filter to last 7 days
week_days = {k: v for k, v in data["days"].items() if k >= WEEK_START}
num_days = len(week_days) or 1

# ═══════════════════════════════════════════
# Aggregate weekly stats
# ═══════════════════════════════════════════
total_calls = sum(d["calls"] for d in week_days.values())
total_input = sum(d["input_tokens"] for d in week_days.values())
total_output = sum(d["output_tokens"] for d in week_days.values())
total_cache_read = sum(d["cache_read_tokens"] for d in week_days.values())
total_cache_create = sum(d["cache_create_tokens"] for d in week_days.values())
total_or_calls = sum(d.get("openrouter", {}).get("calls", 0) for d in week_days.values())
total_or_input = sum(d.get("openrouter", {}).get("input_tokens", 0) for d in week_days.values())
total_or_output = sum(d.get("openrouter", {}).get("output_tokens", 0) for d in week_days.values())

# Per-model aggregation
models_agg = {}
for d in week_days.values():
    for model, stats in d.get("models", {}).items():
        if model not in models_agg:
            models_agg[model] = {"calls": 0, "input_tokens": 0, "output_tokens": 0,
                                 "cache_read_tokens": 0, "cache_create_tokens": 0}
        for k in models_agg[model]:
            models_agg[model][k] += stats.get(k, 0)

# Per-source aggregation
sources_agg = {}
for d in week_days.values():
    for source, stats in d.get("sources", {}).items():
        if source not in sources_agg:
            sources_agg[source] = {"calls": 0, "input_tokens": 0, "output_tokens": 0,
                                   "cache_read_tokens": 0, "cache_create_tokens": 0}
        for k in sources_agg[source]:
            sources_agg[source][k] += stats.get(k, 0)

# ═══════════════════════════════════════════
# Context file scanning
# ═══════════════════════════════════════════
def scan_context_files():
    """Scan all .md files loaded as context by Claude CLI."""
    categories = {}

    def add_file(category, filepath):
        if os.path.isfile(filepath):
            size = os.path.getsize(filepath)
            lines = 0
            try:
                with open(filepath) as f:
                    lines = sum(1 for _ in f)
            except:
                pass
            est_tokens = ceil(size / 4)
            if category not in categories:
                categories[category] = []
            categories[category].append({
                "path": filepath,
                "bytes": size,
                "lines": lines,
                "est_tokens": est_tokens
            })

    # Always loaded — root CLAUDE.md + rules + memory
    add_file("Always Loaded", "/root/CLAUDE.md")
    for f in glob.glob("/root/.claude/rules/*.md"):
        add_file("Always Loaded", f)
    for f in glob.glob("/root/.claude/projects/-root/memory/*.md"):
        if "/backups/" not in f:
            add_file("Shared Memory", f)

    # Overlord
    add_file("Overlord", "/root/overlord/CLAUDE.md")

    # Per-project CLAUDE.md
    for proj_dir in sorted(glob.glob("/root/projects/*/")):
        # Skip symlinks to avoid double-counting (e.g. Overlord -> /root/overlord)
        if os.path.islink(proj_dir.rstrip("/")):
            continue
        name = os.path.basename(proj_dir.rstrip("/"))
        claude_md = os.path.join(proj_dir, "CLAUDE.md")
        if os.path.isfile(claude_md):
            add_file(f"Project: {name}", claude_md)
        # Also check for project-specific memory
        for mem in glob.glob(os.path.join(proj_dir, ".claude/memory/*.md")):
            add_file(f"Project: {name}", mem)

    # Agent definitions
    for f in glob.glob("/root/agents/.claude/agents/*.md"):
        add_file("Agent Definitions", f)

    return categories

context = scan_context_files()
total_context_bytes = sum(f["bytes"] for files in context.values() for f in files)
total_context_tokens = sum(f["est_tokens"] for files in context.values() for f in files)

# ═══════════════════════════════════════════
# Optimization recommendations
# ═══════════════════════════════════════════
def generate_optimizations():
    recs = []

    # 1. Large files > 10KB
    for cat, files in context.items():
        for f in files:
            if f["bytes"] > 10240:
                kb = f["bytes"] / 1024
                relpath = f['path'].replace('/root/', '')
                recs.append(f"LARGE FILE: {relpath} ({kb:.1f}KB / ~{f['est_tokens']:,} tokens) — consider condensing")

    # 2. Cache efficiency
    if total_cache_create > 0:
        cache_ratio = total_cache_read / (total_cache_read + total_cache_create) if (total_cache_read + total_cache_create) > 0 else 0
        if cache_ratio < 0.5:
            recs.append(f"LOW CACHE HIT RATE: {cache_ratio:.0%} reads vs creates — many cold starts (short sessions waste boot tokens)")
        elif cache_ratio > 0.8:
            recs.append(f"GOOD CACHE HIT RATE: {cache_ratio:.0%} — sessions reusing cached context efficiently")

    # 3. Session churn (many calls per day = many sessions)
    avg_calls = total_calls / num_days if num_days > 0 else 0
    if avg_calls > 200:
        recs.append(f"HIGH SESSION VOLUME: ~{avg_calls:.0f} calls/day — consider consolidating tasks into fewer sessions")

    # 4. Output token ratio
    if total_input > 0:
        output_ratio = total_output / total_input
        if output_ratio < 0.1:
            recs.append(f"LOW OUTPUT RATIO: {output_ratio:.1%} of input — lots of reading, little generating. Normal for admin tasks.")

    # 5. Total context size
    if total_context_tokens > 30000:
        recs.append(f"CONTEXT BUDGET: {total_context_tokens:,} tokens loaded per session — consider trimming stale memory files")

    return recs if recs else ["No immediate optimizations needed — usage looks healthy"]

optimizations = generate_optimizations()

# ═══════════════════════════════════════════
# MODEL DISPLAY NAMES
# ═══════════════════════════════════════════
def model_name(model_id):
    names = {
        "claude-opus-4-6": "Opus 4.6",
        "claude-sonnet-4-6": "Sonnet 4.6",
        "claude-haiku-4-5-20251001": "Haiku 4.5",
        "claude-sonnet-4-5-20241022": "Sonnet 4.5",
    }
    return names.get(model_id, model_id)

def fmt_tokens(n):
    """Format token count: 1234567 → 1.2M, 45678 → 45.7K"""
    if n >= 1_000_000:
        return f"{n/1_000_000:.1f}M"
    elif n >= 1_000:
        return f"{n/1_000:.1f}K"
    return str(n)

# ═══════════════════════════════════════════
# OUTPUT 1: WhatsApp Summary
# ═══════════════════════════════════════════
wa_lines = []
wa_lines.append(f"TOKEN USAGE — Week of {WEEK_START} to {TODAY}")
wa_lines.append(f"({num_days} days of data)")
wa_lines.append("")

# Daily averages by model
wa_lines.append("DAILY AVERAGES")
for model_id, stats in sorted(models_agg.items(), key=lambda x: -x[1]["calls"]):
    avg_calls = stats["calls"] / num_days
    avg_output = stats["output_tokens"] / num_days
    wa_lines.append(f"  {model_name(model_id)}: ~{avg_calls:.0f} calls, {fmt_tokens(int(avg_output))} output/day")
if total_or_calls > 0:
    avg_or = total_or_calls / num_days
    wa_lines.append(f"  OpenRouter free: ~{avg_or:.0f} calls/day (free)")
wa_lines.append("")

# Session boot cost
wa_lines.append("SESSION BOOT COST")
wa_lines.append(f"  Context loaded: ~{fmt_tokens(total_context_tokens)} tokens ({total_context_bytes/1024:.0f}KB)")
wa_lines.append("")

# Top context files
wa_lines.append("TOP CONTEXT FILES")
all_files = [(f, cat) for cat, files in context.items() for f in files]
all_files.sort(key=lambda x: -x[0]["bytes"])
for f, cat in all_files[:6]:
    relpath = f["path"].replace("/root/", "")
    kb = f["bytes"] / 1024
    wa_lines.append(f"  {relpath}: {kb:.1f}KB (~{f['est_tokens']:,} tok)")
wa_lines.append("")

# Sources
wa_lines.append("TOP SOURCES")
for source, stats in sorted(sources_agg.items(), key=lambda x: -x[1]["calls"])[:6]:
    wa_lines.append(f"  {source}: {stats['calls']} calls, {fmt_tokens(stats['output_tokens'])} output")
if total_or_calls > 0:
    wa_lines.append(f"  OpenRouter (cron): {total_or_calls} calls (free)")
wa_lines.append("")

# Cron costs
wa_lines.append("CRON TOKEN COSTS (daily)")
wa_lines.append(f"  memory-cleanup: ~{fmt_tokens(int(total_or_input + total_or_output) // max(num_days,1))} tokens (free via OpenRouter)")
wa_lines.append(f"  All other crons: 0 tokens (bash only)")
wa_lines.append("")

# Optimizations
wa_lines.append("RECOMMENDATIONS")
for opt in optimizations[:4]:
    wa_lines.append(f"  • {opt}")

wa_text = "\n".join(wa_lines)
# Save for sending
with open(f"{DATA_DIR}/token-wa-message.txt", "w") as f:
    f.write(wa_text)
print(f"WhatsApp summary: {len(wa_text)} chars")

# ═══════════════════════════════════════════
# OUTPUT 2: Full Markdown Report
# ═══════════════════════════════════════════
md = []
md.append(f"# Token Usage Report — {TODAY}")
md.append(f"Week: {WEEK_START} to {TODAY} ({num_days} days)")
md.append("")

md.append("## Weekly Totals")
md.append(f"- **Total calls:** {total_calls:,}")
md.append(f"- **Input tokens:** {total_input:,}")
md.append(f"- **Output tokens:** {total_output:,}")
md.append(f"- **Cache read:** {total_cache_read:,}")
md.append(f"- **Cache create:** {total_cache_create:,}")
md.append(f"- **OpenRouter calls:** {total_or_calls} (free)")
md.append("")

md.append("## Per-Model Breakdown")
md.append("| Model | Calls | Input | Output | Cache Read | Cache Create |")
md.append("|-------|-------|-------|--------|------------|--------------|")
for model_id, stats in sorted(models_agg.items(), key=lambda x: -x[1]["calls"]):
    md.append(f"| {model_name(model_id)} | {stats['calls']:,} | {fmt_tokens(stats['input_tokens'])} | {fmt_tokens(stats['output_tokens'])} | {fmt_tokens(stats['cache_read_tokens'])} | {fmt_tokens(stats['cache_create_tokens'])} |")
md.append("")

md.append("## Per-Source Breakdown")
md.append("| Source | Calls | Input | Output |")
md.append("|--------|-------|-------|--------|")
for source, stats in sorted(sources_agg.items(), key=lambda x: -x[1]["calls"]):
    md.append(f"| {source} | {stats['calls']:,} | {fmt_tokens(stats['input_tokens'])} | {fmt_tokens(stats['output_tokens'])} |")
md.append("")

md.append("## Daily Breakdown")
md.append("| Date | Calls | Input | Output | Cache Read | Cache Create |")
md.append("|------|-------|-------|--------|------------|--------------|")
for date in sorted(week_days.keys()):
    d = week_days[date]
    md.append(f"| {date} | {d['calls']:,} | {fmt_tokens(d['input_tokens'])} | {fmt_tokens(d['output_tokens'])} | {fmt_tokens(d['cache_read_tokens'])} | {fmt_tokens(d['cache_create_tokens'])} |")
md.append("")

md.append("## Context Files")
md.append(f"**Total:** {total_context_bytes/1024:.1f}KB / ~{total_context_tokens:,} estimated tokens per session")
md.append("")
for cat in sorted(context.keys()):
    files = context[cat]
    cat_bytes = sum(f["bytes"] for f in files)
    cat_tokens = sum(f["est_tokens"] for f in files)
    md.append(f"### {cat} ({cat_bytes/1024:.1f}KB / ~{cat_tokens:,} tokens)")
    for f in sorted(files, key=lambda x: -x["bytes"]):
        relpath = f["path"].replace("/root/", "")
        md.append(f"- `{relpath}` — {f['bytes']:,} bytes, {f['lines']} lines, ~{f['est_tokens']:,} tokens")
    md.append("")

md.append("## Optimizations")
for opt in optimizations:
    md.append(f"- {opt}")
md.append("")

md.append(f"*Generated {datetime.now().strftime('%Y-%m-%d %H:%M')}*")

with open(REPORT_MD, "w") as f:
    f.write("\n".join(md))
print(f"Markdown report: {REPORT_MD}")

# ═══════════════════════════════════════════
# OUTPUT 3: HTML Dashboard
# ═══════════════════════════════════════════
def build_html():
    # Build context tree for collapsible display
    def file_row(f):
        relpath = f["path"].replace("/root/", "")
        kb = f["bytes"] / 1024
        return f'<tr><td class="path">{relpath}</td><td>{kb:.1f}KB</td><td>{f["lines"]}</td><td>~{f["est_tokens"]:,}</td></tr>'

    ctx_sections = ""
    for cat in sorted(context.keys()):
        files = context[cat]
        cat_bytes = sum(f["bytes"] for f in files)
        cat_tokens = sum(f["est_tokens"] for f in files)
        rows = "\n".join(file_row(f) for f in sorted(files, key=lambda x: -x["bytes"]))
        ctx_sections += f'''
        <details>
          <summary>{cat} <span class="badge">{cat_bytes/1024:.1f}KB / ~{cat_tokens:,} tok</span></summary>
          <table class="files">
            <tr><th>File</th><th>Size</th><th>Lines</th><th>Est. Tokens</th></tr>
            {rows}
          </table>
        </details>'''

    # Model rows for table
    model_rows = ""
    for model_id, stats in sorted(models_agg.items(), key=lambda x: -x[1]["calls"]):
        model_rows += f'<tr><td>{model_name(model_id)}</td><td>{stats["calls"]:,}</td><td>{fmt_tokens(stats["input_tokens"])}</td><td>{fmt_tokens(stats["output_tokens"])}</td><td>{fmt_tokens(stats["cache_read_tokens"])}</td><td>{fmt_tokens(stats["cache_create_tokens"])}</td></tr>'

    # Source rows
    source_rows = ""
    for source, stats in sorted(sources_agg.items(), key=lambda x: -x[1]["calls"]):
        source_rows += f'<tr><td>{source}</td><td>{stats["calls"]:,}</td><td>{fmt_tokens(stats["input_tokens"])}</td><td>{fmt_tokens(stats["output_tokens"])}</td></tr>'

    # Daily rows
    daily_rows = ""
    for date in sorted(week_days.keys()):
        d = week_days[date]
        daily_rows += f'<tr><td>{date}</td><td>{d["calls"]:,}</td><td>{fmt_tokens(d["input_tokens"])}</td><td>{fmt_tokens(d["output_tokens"])}</td><td>{fmt_tokens(d["cache_read_tokens"])}</td><td>{fmt_tokens(d["cache_create_tokens"])}</td></tr>'

    # Daily chart data (simple bar chart via CSS)
    max_calls = max((d["calls"] for d in week_days.values()), default=1) or 1
    chart_bars = ""
    for date in sorted(week_days.keys()):
        d = week_days[date]
        pct = (d["calls"] / max_calls) * 100
        label = date[5:]  # MM-DD
        chart_bars += f'<div class="bar-wrap"><div class="bar" style="height:{pct}%"></div><span>{label}</span></div>'

    # Optimization items
    opt_items = "\n".join(f"<li>{o}</li>" for o in optimizations)

    # Cache efficiency
    total_cache = total_cache_read + total_cache_create
    cache_pct = (total_cache_read / total_cache * 100) if total_cache > 0 else 0

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Token Usage Dashboard — {TODAY}</title>
<style>
  :root {{ --bg: #0d1117; --card: #161b22; --border: #30363d; --text: #c9d1d9;
           --accent: #58a6ff; --green: #3fb950; --yellow: #d29922; --red: #f85149; }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: var(--bg); color: var(--text); padding: 20px; max-width: 1200px; margin: 0 auto; }}
  h1 {{ color: var(--accent); margin-bottom: 5px; }}
  .subtitle {{ color: #8b949e; margin-bottom: 20px; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }}
  .stat {{ background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }}
  .stat .label {{ font-size: 12px; color: #8b949e; text-transform: uppercase; }}
  .stat .value {{ font-size: 24px; font-weight: 600; color: var(--accent); }}
  .stat .detail {{ font-size: 11px; color: #8b949e; margin-top: 4px; }}
  table {{ width: 100%; border-collapse: collapse; margin: 8px 0 16px; }}
  th, td {{ padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); font-size: 13px; }}
  th {{ color: #8b949e; font-weight: 500; }}
  .path {{ font-family: monospace; font-size: 12px; word-break: break-all; }}
  details {{ background: var(--card); border: 1px solid var(--border); border-radius: 8px;
             margin-bottom: 8px; }}
  summary {{ padding: 12px 16px; cursor: pointer; font-weight: 500; }}
  summary:hover {{ color: var(--accent); }}
  .badge {{ background: var(--border); padding: 2px 8px; border-radius: 10px; font-size: 11px;
            font-weight: 400; margin-left: 8px; }}
  details table {{ margin: 0 16px 12px; width: calc(100% - 32px); }}
  section {{ margin-bottom: 28px; }}
  section > h2 {{ color: var(--accent); font-size: 16px; margin-bottom: 12px;
                   border-bottom: 1px solid var(--border); padding-bottom: 6px; }}
  .chart {{ display: flex; align-items: flex-end; gap: 8px; height: 120px; padding: 0 4px;
            background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }}
  .bar-wrap {{ flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }}
  .bar {{ width: 100%; max-width: 40px; background: var(--accent); border-radius: 3px 3px 0 0;
          min-height: 2px; transition: height 0.3s; }}
  .bar-wrap span {{ font-size: 10px; color: #8b949e; margin-top: 4px; }}
  .opt {{ background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 16px; }}
  .opt li {{ margin: 6px 0 6px 16px; font-size: 13px; }}
  .cache-bar {{ height: 20px; border-radius: 10px; overflow: hidden; display: flex; margin-top: 4px; }}
  .cache-bar .read {{ background: var(--green); }}
  .cache-bar .create {{ background: var(--yellow); }}
  footer {{ text-align: center; color: #484f58; font-size: 11px; margin-top: 32px; padding-top: 16px;
            border-top: 1px solid var(--border); }}
</style>
</head>
<body>
  <h1>Token Usage Dashboard</h1>
  <p class="subtitle">Week of {WEEK_START} to {TODAY} &middot; {num_days} days of data</p>

  <div class="grid">
    <div class="stat">
      <div class="label">Total Calls</div>
      <div class="value">{total_calls:,}</div>
      <div class="detail">~{total_calls//max(num_days,1):,}/day</div>
    </div>
    <div class="stat">
      <div class="label">Output Tokens</div>
      <div class="value">{fmt_tokens(total_output)}</div>
      <div class="detail">~{fmt_tokens(total_output//max(num_days,1))}/day</div>
    </div>
    <div class="stat">
      <div class="label">Input Tokens</div>
      <div class="value">{fmt_tokens(total_input)}</div>
      <div class="detail">incl. {fmt_tokens(total_cache_read)} cached</div>
    </div>
    <div class="stat">
      <div class="label">Cache Hit Rate</div>
      <div class="value">{cache_pct:.0f}%</div>
      <div class="detail">
        <div class="cache-bar">
          <div class="read" style="width:{cache_pct}%"></div>
          <div class="create" style="width:{100-cache_pct}%"></div>
        </div>
        read vs create
      </div>
    </div>
    <div class="stat">
      <div class="label">Context Boot</div>
      <div class="value">~{fmt_tokens(total_context_tokens)}</div>
      <div class="detail">{total_context_bytes/1024:.0f}KB loaded per session</div>
    </div>
    <div class="stat">
      <div class="label">OpenRouter (Free)</div>
      <div class="value">{total_or_calls}</div>
      <div class="detail">{fmt_tokens(total_or_input + total_or_output)} tokens (free)</div>
    </div>
  </div>

  <section>
    <h2>Daily Activity</h2>
    <div class="chart">{chart_bars}</div>
  </section>

  <section>
    <h2>Per-Model Usage</h2>
    <table>
      <tr><th>Model</th><th>Calls</th><th>Input</th><th>Output</th><th>Cache Read</th><th>Cache Create</th></tr>
      {model_rows}
    </table>
  </section>

  <section>
    <h2>Per-Source Usage</h2>
    <table>
      <tr><th>Source</th><th>Calls</th><th>Input</th><th>Output</th></tr>
      {source_rows}
    </table>
  </section>

  <section>
    <h2>Daily Breakdown</h2>
    <table>
      <tr><th>Date</th><th>Calls</th><th>Input</th><th>Output</th><th>Cache Read</th><th>Cache Create</th></tr>
      {daily_rows}
    </table>
  </section>

  <section>
    <h2>Context Files (Loaded Per Session)</h2>
    <p style="color:#8b949e;font-size:13px;margin-bottom:12px;">
      Total: {total_context_bytes/1024:.1f}KB / ~{total_context_tokens:,} tokens &middot; estimated at 4 bytes/token
    </p>
    {ctx_sections}
  </section>

  <section>
    <h2>Optimization Recommendations</h2>
    <div class="opt"><ul>{opt_items}</ul></div>
  </section>

  <footer>Generated {datetime.now().strftime('%Y-%m-%d %H:%M')} &middot; Overlord Token Dashboard</footer>
</body>
</html>'''
    return html

with open(DASHBOARD_HTML, "w") as f:
    f.write(build_html())
print(f"HTML dashboard: {DASHBOARD_HTML}")

PYEOF

# ─── Send WhatsApp message ───
if [ -f "$DATA_DIR/token-wa-message.txt" ] && [ -n "$WEBHOOK_TOKEN" ]; then
  WA_TEXT=$(cat "$DATA_DIR/token-wa-message.txt")
  # Escape for JSON
  WA_JSON=$(python3 -c "
import json, sys
with open('$DATA_DIR/token-wa-message.txt') as f:
    text = f.read()
print(json.dumps({'to': 'admin', 'text': text}))
")
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$SEND_URL" \
    -H "Authorization: Bearer $WEBHOOK_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$WA_JSON")
  if [ "$HTTP_CODE" = "200" ]; then
    echo "WhatsApp summary sent successfully"
  else
    echo "WARN: WhatsApp send returned HTTP $HTTP_CODE"
  fi
  rm -f "$DATA_DIR/token-wa-message.txt"
else
  echo "WARN: Skipping WhatsApp send (no token or no message)"
fi

echo "=== Dashboard complete ==="
