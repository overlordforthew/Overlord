#!/usr/bin/env python3
"""news.py — News headlines from major RSS feeds (free, no API key)."""

import argparse
import json
import sys
import feedparser

FEEDS = {
    "top": [
        ("BBC News", "https://feeds.bbci.co.uk/news/rss.xml"),
        ("Reuters", "https://www.reutersagency.com/feed/"),
    ],
    "tech": [
        ("TechCrunch", "https://techcrunch.com/feed/"),
        ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
        ("Hacker News", "https://hnrss.org/frontpage"),
    ],
    "crypto": [
        ("CoinDesk", "https://www.coindesk.com/arc/outboundfeeds/rss/"),
        ("CoinTelegraph", "https://cointelegraph.com/rss"),
    ],
    "business": [
        ("CNBC", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"),
        ("Bloomberg", "https://feeds.bloomberg.com/markets/news.rss"),
    ],
    "ai": [
        ("AI News", "https://www.artificialintelligence-news.com/feed/"),
        ("MIT AI", "https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml"),
    ],
}

def fetch_feeds(topic="top", limit=10):
    feeds = FEEDS.get(topic, FEEDS["top"])
    articles = []
    for name, url in feeds:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:limit]:
                articles.append({
                    "source": name,
                    "title": entry.get("title", "No title"),
                    "link": entry.get("link", ""),
                    "published": entry.get("published", entry.get("updated", "")),
                    "summary": entry.get("summary", "")[:150],
                })
        except Exception:
            continue
    # Sort by published date (most recent first)
    articles.sort(key=lambda x: x.get("published", ""), reverse=True)
    return articles[:limit]

def main():
    parser = argparse.ArgumentParser(description="News headlines")
    parser.add_argument("--topic", default="top", choices=list(FEEDS.keys()),
                       help="News topic (default: top)")
    parser.add_argument("--limit", type=int, default=10, help="Number of headlines")
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--topics", action="store_true", help="List available topics")
    args = parser.parse_args()

    if args.topics:
        for topic, feeds in FEEDS.items():
            sources = ", ".join(name for name, _ in feeds)
            print(f"  {topic:12s} — {sources}")
        return

    articles = fetch_feeds(args.topic, args.limit)

    if args.as_json:
        print(json.dumps(articles, indent=2))
    else:
        print(f"News: {args.topic} ({len(articles)} headlines)\n")
        for i, a in enumerate(articles, 1):
            print(f"{i:2d}. [{a['source']}] {a['title']}")
            if a['link']:
                print(f"    {a['link']}")
            print()

if __name__ == "__main__":
    main()
