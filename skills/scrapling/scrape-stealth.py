#!/usr/bin/env python3
"""scrape-stealth.py — Stealth web scraping with anti-bot bypass via Scrapling.

Uses TLS fingerprinting and browser-realistic headers to bypass Cloudflare
and other anti-bot systems. Falls back to requests+BS4 if Scrapling unavailable.
"""

import argparse
import json
import sys
import csv
import io
from urllib.parse import urljoin

def get_fetcher():
    """Get the best available fetcher."""
    try:
        from scrapling import Fetcher
        return Fetcher(), "scrapling"
    except ImportError:
        return None, "fallback"

def fetch_url(url, fetcher_obj, engine):
    """Fetch a URL using the best available method."""
    if engine == "scrapling":
        page = fetcher_obj.get(url)
        if page.status != 200:
            print(f"Warning: HTTP {page.status} for {url}", file=sys.stderr)
        return page
    else:
        import requests
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
        }
        resp = requests.get(url, headers=headers, timeout=20)
        resp.raise_for_status()
        return resp

def to_soup(page, engine):
    """Convert any page response to a BeautifulSoup object."""
    from bs4 import BeautifulSoup
    if engine == "scrapling":
        return BeautifulSoup(page.html_content, "lxml")
    else:
        return BeautifulSoup(page.text, "lxml")

def extract_text(page, engine):
    """Extract clean text from a page."""
    soup = to_soup(page, engine)
    for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
        tag.decompose()
    return soup.get_text(separator="\n", strip=True)

def extract_links(page, engine, base_url):
    """Extract all links from a page."""
    soup = to_soup(page, engine)
    links = []
    for a in soup.find_all("a", href=True):
        href = a["href"]
        text = a.get_text(strip=True)
        if href.startswith("/"):
            href = urljoin(base_url, href)
        if href.startswith("http"):
            links.append({"text": text[:100], "url": href})
    return links

def extract_tables(page, engine):
    """Extract tables as structured data."""
    soup = to_soup(page, engine)
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

def extract_selector(page, selector, engine):
    """Extract elements matching a CSS selector."""
    soup = to_soup(page, engine)
    elements = soup.select(selector)
    return [el.get_text(strip=True) for el in elements]

def follow_pagination(url, fetcher_obj, engine, selector, next_selector, max_pages):
    """Follow pagination links and collect data."""
    all_data = []
    current_url = url
    for i in range(max_pages):
        page = fetch_url(current_url, fetcher_obj, engine)
        if selector:
            data = extract_selector(page, selector, engine)
        else:
            data = [extract_text(page, engine)]
        all_data.extend(data)

        # Find next page link
        soup = to_soup(page, engine)
        sel = next_selector or "a[rel='next'], a.next, .pagination a:last-child"
        next_links = soup.select(sel)
        if next_links and next_links[0].get("href"):
            current_url = urljoin(current_url, next_links[0]["href"])
        else:
            break
    return all_data

def main():
    parser = argparse.ArgumentParser(description="Stealth web scraper with anti-bot bypass")
    parser.add_argument("url", help="URL to scrape")
    parser.add_argument("--links", action="store_true", help="Extract all links")
    parser.add_argument("--tables", action="store_true", help="Extract tables")
    parser.add_argument("--selector", type=str, help="CSS selector to extract")
    parser.add_argument("--json", action="store_true", dest="as_json", help="Output as JSON")
    parser.add_argument("--follow-next", action="store_true", help="Follow pagination")
    parser.add_argument("--next-selector", type=str, help="CSS selector for next page link")
    parser.add_argument("--max-pages", type=int, default=5, help="Max pages to follow (default: 5)")
    parser.add_argument("--output", type=str, help="Save output to file")
    parser.add_argument("--max-length", type=int, default=8000, help="Max text output length (default: 8000)")
    args = parser.parse_args()

    fetcher_obj, engine = get_fetcher()
    if engine == "scrapling":
        print("[Using Scrapling stealth fetcher]", file=sys.stderr)
    else:
        print("[Scrapling unavailable, using requests fallback]", file=sys.stderr)

    try:
        if args.follow_next:
            results = follow_pagination(
                args.url, fetcher_obj, engine,
                args.selector, args.next_selector, args.max_pages
            )
            output = json.dumps(results, indent=2) if args.as_json else "\n---\n".join(str(r) for r in results)

        elif args.links:
            page = fetch_url(args.url, fetcher_obj, engine)
            links = extract_links(page, engine, args.url)
            if args.as_json:
                output = json.dumps(links, indent=2)
            else:
                output = "\n".join(f"{l['text'][:60]:60s} {l['url']}" for l in links)

        elif args.tables:
            page = fetch_url(args.url, fetcher_obj, engine)
            tables = extract_tables(page, engine)
            if args.as_json:
                output = json.dumps(tables, indent=2)
            else:
                buf = io.StringIO()
                writer = csv.writer(buf)
                for t in tables:
                    buf.write(f"\n--- Table {t['table_index']} ---\n")
                    for row in t["rows"]:
                        writer.writerow(row)
                output = buf.getvalue()

        elif args.selector:
            page = fetch_url(args.url, fetcher_obj, engine)
            results = extract_selector(page, args.selector, engine)
            if args.as_json:
                output = json.dumps(results, indent=2)
            else:
                output = "\n".join(results)

        else:
            page = fetch_url(args.url, fetcher_obj, engine)
            text = extract_text(page, engine)
            if args.as_json:
                output = json.dumps({"url": args.url, "engine": engine, "text": text[:args.max_length]})
            else:
                output = text[:args.max_length]

        if args.output:
            with open(args.output, "w") as f:
                f.write(output)
            print(f"Saved to {args.output}", file=sys.stderr)
        else:
            print(output)

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
