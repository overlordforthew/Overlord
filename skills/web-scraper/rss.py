#!/usr/bin/env python3
"""rss.py — Read RSS/Atom feeds and display recent articles."""

import argparse
import json
import sys
import feedparser
from datetime import datetime

def main():
    parser = argparse.ArgumentParser(description="Read RSS/Atom feeds")
    parser.add_argument("url", help="RSS feed URL")
    parser.add_argument("--limit", type=int, default=10, help="Number of articles (default: 10)")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Output as JSON")
    args = parser.parse_args()

    try:
        feed = feedparser.parse(args.url)
    except Exception as e:
        print(f"Error parsing feed: {e}", file=sys.stderr)
        sys.exit(1)

    if feed.bozo and not feed.entries:
        print(f"Error: Could not parse feed from {args.url}", file=sys.stderr)
        sys.exit(1)

    articles = []
    for entry in feed.entries[:args.limit]:
        article = {
            "title": entry.get("title", "No title"),
            "link": entry.get("link", ""),
            "published": entry.get("published", entry.get("updated", "")),
            "summary": entry.get("summary", "")[:200],
        }
        articles.append(article)

    if args.as_json:
        print(json.dumps({
            "feed_title": feed.feed.get("title", "Unknown"),
            "articles": articles
        }, indent=2))
    else:
        print(f"Feed: {feed.feed.get('title', 'Unknown')}")
        print(f"Articles: {len(articles)}\n")
        for i, a in enumerate(articles, 1):
            print(f"{i}. {a['title']}")
            if a['published']:
                print(f"   {a['published']}")
            print(f"   {a['link']}")
            if a['summary']:
                clean = a['summary'].replace('<', '').replace('>', '')[:150]
                print(f"   {clean}")
            print()

if __name__ == "__main__":
    main()
