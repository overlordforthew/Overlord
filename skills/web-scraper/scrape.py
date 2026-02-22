#!/usr/bin/env python3
"""scrape.py — Extract clean text, links, tables, or CSS-selected elements from any URL."""

import argparse
import json
import sys
import csv
import io
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

def fetch(url, timeout=15):
    resp = requests.get(url, headers=HEADERS, timeout=timeout)
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "lxml")

def extract_text(soup):
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    return soup.get_text(separator="\n", strip=True)

def extract_links(soup, base_url):
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if href.startswith("/"):
            from urllib.parse import urljoin
            href = urljoin(base_url, href)
        if href.startswith("http"):
            links.append({"text": text, "url": href})
    return links

def extract_tables(soup):
    results = []
    for i, table in enumerate(soup.find_all("table")):
        rows = []
        for tr in table.find_all("tr"):
            cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
            if cells:
                rows.append(cells)
        if rows:
            results.append({"table_index": i, "rows": rows})
    return results

def extract_selector(soup, selector):
    elements = soup.select(selector)
    return [el.get_text(strip=True) for el in elements]

def main():
    parser = argparse.ArgumentParser(description="Scrape a URL for content")
    parser.add_argument("url", help="URL to scrape")
    parser.add_argument("--links", action="store_true", help="Extract all links")
    parser.add_argument("--tables", action="store_true", help="Extract tables as CSV")
    parser.add_argument("--selector", type=str, help="CSS selector to extract")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Output as JSON")
    parser.add_argument("--force", action="store_true", help="Ignore robots.txt")
    args = parser.parse_args()

    try:
        soup = fetch(args.url)
    except Exception as e:
        print(f"Error fetching {args.url}: {e}", file=sys.stderr)
        sys.exit(1)

    if args.links:
        links = extract_links(soup, args.url)
        if args.as_json:
            print(json.dumps(links, indent=2))
        else:
            for link in links:
                print(f"{link['text'][:60]:60s} {link['url']}")

    elif args.tables:
        tables = extract_tables(soup)
        if args.as_json:
            print(json.dumps(tables, indent=2))
        else:
            for t in tables:
                print(f"\n--- Table {t['table_index']} ---")
                writer = csv.writer(sys.stdout)
                for row in t["rows"]:
                    writer.writerow(row)

    elif args.selector:
        results = extract_selector(soup, args.selector)
        if args.as_json:
            print(json.dumps(results, indent=2))
        else:
            for r in results:
                print(r)

    else:
        text = extract_text(soup)
        if args.as_json:
            print(json.dumps({"url": args.url, "text": text}))
        else:
            print(text[:5000])

if __name__ == "__main__":
    main()
