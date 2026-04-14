#!/usr/bin/env python3
"""chart.py — Generate charts from CSV/JSON data."""

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
            return data if isinstance(data, list) else [data]
    else:
        with open(filepath, newline='', encoding='utf-8-sig') as f:
            return list(csv.DictReader(f))

def try_float(val):
    try:
        return float(str(val).replace(",", "").replace("$", "").replace("%", ""))
    except (ValueError, AttributeError):
        return 0.0

def main():
    parser = argparse.ArgumentParser(description="Generate charts")
    parser.add_argument("file", help="CSV or JSON file")
    parser.add_argument("--type", choices=["bar", "line", "pie", "scatter"], default="bar")
    parser.add_argument("--x", required=True, help="X-axis column")
    parser.add_argument("--y", required=True, help="Y-axis column")
    parser.add_argument("--title", type=str, default="", help="Chart title")
    parser.add_argument("--output", type=str, default="chart.png", help="Output file path")
    parser.add_argument("--limit", type=int, default=20, help="Max data points")
    args = parser.parse_args()

    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    try:
        rows = load_data(args.file)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    rows = rows[:args.limit]
    x_vals = [str(r.get(args.x, ""))[:20] for r in rows]
    y_vals = [try_float(r.get(args.y, 0)) for r in rows]

    title = args.title or f"{args.y} by {args.x}"

    fig, ax = plt.subplots(figsize=(10, 6))

    if args.type == "bar":
        ax.bar(range(len(x_vals)), y_vals, color="#4A90D9")
        ax.set_xticks(range(len(x_vals)))
        ax.set_xticklabels(x_vals, rotation=45, ha="right")
    elif args.type == "line":
        ax.plot(range(len(x_vals)), y_vals, marker="o", color="#4A90D9")
        ax.set_xticks(range(len(x_vals)))
        ax.set_xticklabels(x_vals, rotation=45, ha="right")
    elif args.type == "pie":
        ax.pie(y_vals, labels=x_vals, autopct="%1.1f%%")
    elif args.type == "scatter":
        ax.scatter(range(len(x_vals)), y_vals, color="#4A90D9")
        ax.set_xticks(range(len(x_vals)))
        ax.set_xticklabels(x_vals, rotation=45, ha="right")

    ax.set_title(title)
    if args.type != "pie":
        ax.set_xlabel(args.x)
        ax.set_ylabel(args.y)

    plt.tight_layout()
    plt.savefig(args.output, dpi=150)
    print(f"Chart saved to {args.output}")

if __name__ == "__main__":
    main()
