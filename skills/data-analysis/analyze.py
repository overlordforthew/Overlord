#!/usr/bin/env python3
"""analyze.py — Analyze CSV/JSON data files with filtering, sorting, and statistics."""

import argparse
import csv
import json
import sys
import os

def load_data(filepath):
    ext = os.path.splitext(filepath)[1].lower()
    if ext == ".json":
        with open(filepath) as f:
            data = json.load(f)
            if isinstance(data, list):
                return data
            elif isinstance(data, dict) and any(isinstance(v, list) for v in data.values()):
                for v in data.values():
                    if isinstance(v, list):
                        return v
            return [data]
    else:
        with open(filepath, newline='', encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            return list(reader)

def try_float(val):
    try:
        return float(val.replace(",", "").replace("$", "").replace("%", ""))
    except (ValueError, AttributeError):
        return None

def summarize(rows, columns=None):
    if not rows:
        print("No data")
        return
    all_cols = list(rows[0].keys())
    cols = columns if columns else all_cols

    print(f"Rows: {len(rows)} | Columns: {len(all_cols)}")
    print(f"Columns: {', '.join(all_cols)}\n")

    for col in cols:
        if col not in all_cols:
            continue
        values = [r.get(col, "") for r in rows]
        nums = [try_float(v) for v in values if try_float(v) is not None]
        print(f"--- {col} ---")
        print(f"  Non-empty: {sum(1 for v in values if v)}/{len(values)}")
        if nums:
            print(f"  Min: {min(nums):,.2f}  Max: {max(nums):,.2f}  Avg: {sum(nums)/len(nums):,.2f}")
        else:
            unique = list(set(values))
            if len(unique) <= 10:
                for u in sorted(unique)[:10]:
                    count = values.count(u)
                    print(f"  '{u}': {count}")
            else:
                print(f"  Unique values: {len(unique)}")
        print()

def print_table(rows, columns=None, limit=None):
    if not rows:
        return
    cols = columns if columns else list(rows[0].keys())
    display = rows[:limit] if limit else rows

    widths = {c: max(len(c), max((len(str(r.get(c, "")))[:30] for r in display), default=0)) for c in cols}
    header = "  ".join(f"{c:{widths[c]}s}" for c in cols)
    print(header)
    print("-" * len(header))
    for r in display:
        print("  ".join(f"{str(r.get(c, ''))[:30]:{widths[c]}s}" for c in cols))

def main():
    parser = argparse.ArgumentParser(description="Analyze data files")
    parser.add_argument("file", help="CSV or JSON file path")
    parser.add_argument("--columns", type=str, help="Comma-separated columns to show")
    parser.add_argument("--filter", type=str, dest="filter_expr", help="Filter expression (e.g., 'age>30')")
    parser.add_argument("--sort", type=str, help="Sort by column")
    parser.add_argument("--desc", action="store_true", help="Sort descending")
    parser.add_argument("--top", type=int, help="Show first N rows")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    try:
        rows = load_data(args.file)
    except Exception as e:
        print(f"Error loading {args.file}: {e}", file=sys.stderr)
        sys.exit(1)

    columns = args.columns.split(",") if args.columns else None

    # Filter
    if args.filter_expr:
        import re
        m = re.match(r'(\w+)\s*([><=!]+)\s*(.+)', args.filter_expr)
        if m:
            col, op, val = m.groups()
            filtered = []
            for r in rows:
                rv = try_float(r.get(col, ""))
                fv = try_float(val)
                if rv is not None and fv is not None:
                    if op == ">" and rv > fv: filtered.append(r)
                    elif op == ">=" and rv >= fv: filtered.append(r)
                    elif op == "<" and rv < fv: filtered.append(r)
                    elif op == "<=" and rv <= fv: filtered.append(r)
                    elif op == "==" and rv == fv: filtered.append(r)
                    elif op == "!=" and rv != fv: filtered.append(r)
                elif op == "==" and r.get(col, "") == val: filtered.append(r)
                elif op == "!=" and r.get(col, "") != val: filtered.append(r)
            rows = filtered

    # Sort
    if args.sort:
        def sort_key(r):
            v = try_float(r.get(args.sort, ""))
            return v if v is not None else float('-inf')
        rows.sort(key=sort_key, reverse=args.desc)

    if args.as_json:
        print(json.dumps(rows[:args.top] if args.top else rows, indent=2))
    elif args.top or args.filter_expr or args.sort:
        print_table(rows, columns, args.top)
        print(f"\n({len(rows)} rows)")
    else:
        summarize(rows, columns)

if __name__ == "__main__":
    main()
