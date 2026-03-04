#!/bin/bash
# token-aggregate.sh — Daily token usage aggregation
# Runs at 2:55 AM BEFORE the 3 AM session cleanup to capture JSONL data.
# Parses Claude CLI session files + LLM CLI SQLite DB.
# Outputs rolling 90-day data to /root/overlord/data/token-usage.json

set -euo pipefail

DATA_DIR="/root/overlord/data"
OUTPUT="$DATA_DIR/token-usage.json"
CLAUDE_PROJECTS="/root/.claude/projects"
TODAY=$(date +%Y-%m-%d)

echo "=== Token Aggregation: $TODAY ==="

mkdir -p "$DATA_DIR"

# Load existing data or start fresh
if [ -f "$OUTPUT" ]; then
  EXISTING=$(cat "$OUTPUT")
else
  EXISTING='{"days":{}}'
fi

# ─── Parse all Claude CLI JSONL session files ───
python3 << 'PYEOF'
import json, os, glob, sys
from datetime import datetime, timedelta
from math import ceil

CLAUDE_PROJECTS = "/root/.claude/projects"
OUTPUT = "/root/overlord/data/token-usage.json"
TODAY = datetime.now().strftime("%Y-%m-%d")

# Load existing data
try:
    with open(OUTPUT) as f:
        data = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    data = {"days": {}}

# Always reset today's entry (script may run multiple times per day)
data["days"][TODAY] = {
    "models": {},
    "sources": {},
    "calls": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "cache_read_tokens": 0,
    "cache_create_tokens": 0,
    "openrouter": {"calls": 0, "input_tokens": 0, "output_tokens": 0}
}

day = data["days"][TODAY]

# ─── Source classification from directory name ───
def classify_source(dirpath):
    """Determine source from JSONL directory path."""
    parts = dirpath.replace(CLAUDE_PROJECTS + "/", "")
    first = parts.split("/")[0]
    if first.startswith("-app-data-"):
        return "WhatsApp Bot"
    elif first == "-app":
        return "WhatsApp Bot"
    elif first.startswith("-projects-"):
        project = first.replace("-projects-", "")
        return project
    elif first == "-projects":
        return "CLI Sessions"
    elif first.startswith("-root-projects-"):
        project = first.replace("-root-projects-", "")
        return project
    elif first.startswith("-root"):
        return "CLI Sessions"
    elif first.startswith("-tmp-"):
        name = first.replace("-tmp-", "")
        return f"Temp/{name}"
    else:
        return "Other"

# ─── Scan all JSONL files ───
jsonl_files = glob.glob(f"{CLAUDE_PROJECTS}/**/*.jsonl", recursive=True)
parsed = 0
errors = 0

for filepath in jsonl_files:
    dirpath = os.path.dirname(filepath)
    source = classify_source(dirpath)

    try:
        with open(filepath) as f:
            for line in f:
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                if entry.get("type") != "assistant":
                    continue
                msg = entry.get("message", {})
                usage = msg.get("usage", {})

                input_tok = usage.get("input_tokens", 0)
                output_tok = usage.get("output_tokens", 0)
                cache_read = usage.get("cache_read_input_tokens", 0)
                cache_create = usage.get("cache_creation_input_tokens", 0)
                model = msg.get("model", "unknown")

                # Check timestamp — only count entries from today
                ts = entry.get("timestamp", "")
                if ts:
                    entry_date = ts[:10]  # "2026-03-04T..." → "2026-03-04"
                    if entry_date != TODAY:
                        continue

                # Skip entries with no tokens
                if input_tok == 0 and output_tok == 0 and cache_create == 0:
                    continue

                # Aggregate into day totals
                day["calls"] += 1
                day["input_tokens"] += input_tok
                day["output_tokens"] += output_tok
                day["cache_read_tokens"] += cache_read
                day["cache_create_tokens"] += cache_create

                # Per-model tracking
                if model not in day["models"]:
                    day["models"][model] = {
                        "calls": 0, "input_tokens": 0, "output_tokens": 0,
                        "cache_read_tokens": 0, "cache_create_tokens": 0
                    }
                m = day["models"][model]
                m["calls"] += 1
                m["input_tokens"] += input_tok
                m["output_tokens"] += output_tok
                m["cache_read_tokens"] += cache_read
                m["cache_create_tokens"] += cache_create

                # Per-source tracking
                if source not in day["sources"]:
                    day["sources"][source] = {
                        "calls": 0, "input_tokens": 0, "output_tokens": 0,
                        "cache_read_tokens": 0, "cache_create_tokens": 0
                    }
                s = day["sources"][source]
                s["calls"] += 1
                s["input_tokens"] += input_tok
                s["output_tokens"] += output_tok
                s["cache_read_tokens"] += cache_read
                s["cache_create_tokens"] += cache_create

                parsed += 1
    except Exception as e:
        errors += 1
        print(f"  ERROR parsing {filepath}: {e}", file=sys.stderr)

print(f"  Claude CLI: {parsed} entries from {len(jsonl_files)} files ({errors} errors)")

# ─── Parse LLM CLI (OpenRouter) from container DB ───
try:
    import subprocess
    result = subprocess.run(
        ["docker", "exec", "overlord", "python3", "-c", f"""
import sqlite3, json
conn = sqlite3.connect('/root/.config/io.datasette.llm/logs.db')
cursor = conn.execute(
    "SELECT model, input_tokens, output_tokens FROM responses WHERE datetime_utc LIKE '{TODAY}%'"
)
rows = [dict(zip(['model','input_tokens','output_tokens'], r)) for r in cursor]
conn.close()
print(json.dumps(rows))
"""],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode == 0:
        llm_rows = json.loads(result.stdout.strip())
        for row in llm_rows:
            day["openrouter"]["calls"] += 1
            day["openrouter"]["input_tokens"] += (row.get("input_tokens") or 0)
            day["openrouter"]["output_tokens"] += (row.get("output_tokens") or 0)
        print(f"  OpenRouter: {len(llm_rows)} entries from LLM CLI DB")
    else:
        print(f"  OpenRouter: container query failed — {result.stderr[:100]}", file=sys.stderr)
except Exception as e:
    print(f"  OpenRouter: skipped — {e}", file=sys.stderr)

# ─── Prune entries older than 90 days ───
cutoff = (datetime.now() - timedelta(days=90)).strftime("%Y-%m-%d")
old_keys = [k for k in data["days"] if k < cutoff]
for k in old_keys:
    del data["days"][k]
if old_keys:
    print(f"  Pruned {len(old_keys)} days older than {cutoff}")

# ─── Write output ───
with open(OUTPUT, "w") as f:
    json.dump(data, f, indent=2)

total_tokens = day["input_tokens"] + day["output_tokens"] + day["cache_create_tokens"]
print(f"  Today: {day['calls']} calls, {total_tokens:,} total tokens")
print(f"  Models: {', '.join(day['models'].keys()) or 'none'}")
print(f"  Sources: {', '.join(day['sources'].keys()) or 'none'}")
print(f"  Data: {len(data['days'])} days in rolling window")
PYEOF

echo "=== Done ==="
