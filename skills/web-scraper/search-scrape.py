#!/usr/bin/env python3
"""search-scrape.py — Scrape search results for a query using DuckDuckGo HTML."""

import argparse
import json
import sys
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

def search_ddg(query, limit=10):
    """Search DuckDuckGo HTML version (no API key needed)."""
    url = "https://html.duckduckgo.com/html/"
    resp = requests.post(url, data={"q": query}, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    results = []
    for result in soup.select(".result")[:limit]:
        title_el = result.select_one(".result__title a")
        snippet_el = result.select_one(".result__snippet")
        if title_el:
            title = title_el.get_text(strip=True)
            link = title_el.get("href", "")
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""
            results.append({"title": title, "url": link, "snippet": snippet})
    return results

def main():
    parser = argparse.ArgumentParser(description="Search the web")
    parser.add_argument("query", nargs="+", help="Search query")
    parser.add_argument("--limit", type=int, default=10, help="Number of results")
    parser.add_argument("--json", action="store_true", dest="as_json", help="JSON output")
    args = parser.parse_args()

    query = " ".join(args.query)
    try:
        results = search_ddg(query, args.limit)
    except Exception as e:
        print(f"Search error: {e}", file=sys.stderr)
        sys.exit(1)

    if args.as_json:
        print(json.dumps(results, indent=2))
    else:
        print(f"Search: {query}\nResults: {len(results)}\n")
        for i, r in enumerate(results, 1):
            print(f"{i}. {r['title']}")
            print(f"   {r['url']}")
            if r['snippet']:
                print(f"   {r['snippet'][:150]}")
            print()

if __name__ == "__main__":
    main()
