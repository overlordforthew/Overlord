#!/usr/bin/env python3
"""xtrends.py — X/Twitter trending topics, tweet search, and user profiles.

Primary: twikit (free Python library using X internal API)
Fallback (trends only): scrape GetDayTrends.com → Trends24.in
"""

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
from pathlib import Path

# ---------------------------------------------------------------------------
# Cache
# ---------------------------------------------------------------------------
CACHE_DIR = Path("/tmp/x_cache")
CACHE_DIR.mkdir(exist_ok=True)

CACHE_TTL = {
    "trends": 3600,    # 1 hour
    "search": 1800,    # 30 min
    "user": 3600,      # 1 hour
}

def _cache_key(prefix, *parts):
    h = hashlib.md5("|".join(str(p) for p in parts).encode()).hexdigest()[:12]
    return CACHE_DIR / f"{prefix}_{h}.json"

def cache_get(prefix, *parts):
    path = _cache_key(prefix, *parts)
    if path.exists():
        try:
            data = json.loads(path.read_text())
            if time.time() - data.get("_ts", 0) < CACHE_TTL.get(prefix, 3600):
                return data.get("payload")
        except (json.JSONDecodeError, KeyError):
            pass
    return None

def cache_set(prefix, payload, *parts):
    path = _cache_key(prefix, *parts)
    path.write_text(json.dumps({"_ts": time.time(), "payload": payload}))

# ---------------------------------------------------------------------------
# Twikit client (lazy init)
# ---------------------------------------------------------------------------
COOKIE_PATH = Path("/tmp/x_cookies.json")
_client = None

async def get_client():
    """Get authenticated twikit client, re-using cookies when possible."""
    global _client
    try:
        from twikit import Client
    except ImportError:
        print("twikit not installed", file=sys.stderr)
        return None

    if _client is not None:
        return _client

    username = os.environ.get("X_USERNAME", "")
    email = os.environ.get("X_EMAIL", "")
    password = os.environ.get("X_PASSWORD", "")

    if not all([username, email, password]):
        print("X credentials not configured (X_USERNAME, X_EMAIL, X_PASSWORD)", file=sys.stderr)
        return None

    client = Client("en-US")

    # Try loading saved cookies first, validate with a lightweight call
    if COOKIE_PATH.exists():
        try:
            client.load_cookies(str(COOKIE_PATH))
            # Validate session — if cookies are stale this will throw
            await client.user()
            _client = client
            return client
        except Exception:
            print("Saved cookies expired, re-authenticating...", file=sys.stderr)
            COOKIE_PATH.unlink(missing_ok=True)

    # Fresh login
    try:
        await client.login(auth_info_1=username, auth_info_2=email, password=password)
        client.save_cookies(str(COOKIE_PATH))
        _client = client
        return client
    except Exception as e:
        print(f"X login failed: {e}", file=sys.stderr)
        return None

# ---------------------------------------------------------------------------
# Fallback scrapers (trends only)
# ---------------------------------------------------------------------------
def _scrape_getdaytrends():
    """Scrape trending topics from GetDayTrends.com (worldwide)."""
    import requests
    from bs4 import BeautifulSoup

    url = "https://getdaytrends.com/"
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    trends = []
    for tr in soup.select("table.table tbody tr"):
        name_el = tr.select_one("td a")
        if not name_el:
            continue
        name = name_el.get_text(strip=True)
        if not name:
            continue
        volume_el = tr.select_one("td.text-right")
        volume = volume_el.get_text(strip=True) if volume_el else None
        trends.append({"name": name, "volume": volume, "source": "getdaytrends.com"})
    return trends

def _scrape_trends24():
    """Scrape trending topics from Trends24.in (worldwide)."""
    import requests
    from bs4 import BeautifulSoup

    url = "https://trends24.in/"
    headers = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"}
    resp = requests.get(url, headers=headers, timeout=15)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "lxml")

    trends = []
    # Trends24 lists trends in ordered list cards
    for card in soup.select(".trend-card"):
        for li in card.select("ol li a"):
            name = li.get_text(strip=True)
            if name:
                trends.append({"name": name, "volume": None, "source": "trends24.in"})
        if trends:
            break  # first card = most recent hour
    return trends

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------
async def cmd_trends(count=20, as_json=False, fallback_only=True):
    """Get trending topics on X."""
    cached = cache_get("trends", "worldwide", count)
    if cached:
        return _output_trends(cached, as_json, count)

    trends = None

    # Primary: twikit (disabled by default — Cloudflare blocks datacenter IPs)
    if not fallback_only:
        client = await get_client()
        if client:
            try:
                raw = await client.get_trends("trending")
                trends = []
                for t in raw:
                    name = t.name if hasattr(t, "name") else str(t)
                    volume = None
                    if hasattr(t, "tweets_count"):
                        volume = str(t.tweets_count)
                    elif hasattr(t, "tweet_volume") and t.tweet_volume:
                        volume = str(t.tweet_volume)
                    trends.append({"name": name, "volume": volume, "source": "x.com"})
            except Exception as e:
                print(f"twikit trends failed: {e}", file=sys.stderr)

    # Fallback 1: GetDayTrends
    if not trends:
        try:
            trends = _scrape_getdaytrends()
            if trends:
                print("Using fallback: getdaytrends.com", file=sys.stderr)
        except Exception as e:
            print(f"GetDayTrends fallback failed: {e}", file=sys.stderr)

    # Fallback 2: Trends24
    if not trends:
        try:
            trends = _scrape_trends24()
            if trends:
                print("Using fallback: trends24.in", file=sys.stderr)
        except Exception as e:
            print(f"Trends24 fallback failed: {e}", file=sys.stderr)

    if not trends:
        print("ERROR: All trend sources failed", file=sys.stderr)
        sys.exit(1)

    cache_set("trends", trends, "worldwide", count)
    return _output_trends(trends, as_json, count)

def _output_trends(trends, as_json, count):
    trends = trends[:count]
    if as_json:
        print(json.dumps(trends, indent=2))
    else:
        print(f"Trending on X ({len(trends)} topics):\n")
        for i, t in enumerate(trends, 1):
            vol = f"  ({t['volume']})" if t.get("volume") else ""
            src = f"  [{t['source']}]" if t.get("source") else ""
            print(f"  {i:2d}. {t['name']}{vol}{src}")
    return trends

async def cmd_search(query, mode="Top", count=10, as_json=False):
    """Search tweets on X."""
    cached = cache_get("search", query, mode, count)
    if cached:
        return _output_search(cached, query, as_json, count)

    client = await get_client()
    if not client:
        print("ERROR: X authentication required for search (set X_USERNAME, X_EMAIL, X_PASSWORD)", file=sys.stderr)
        sys.exit(1)

    try:
        result = await client.search_tweet(query, product=mode, count=count)
        tweets = []
        for tw in result:
            tweet = {
                "id": tw.id if hasattr(tw, "id") else None,
                "text": tw.text if hasattr(tw, "text") else str(tw),
                "user": tw.user.name if hasattr(tw, "user") and tw.user else "Unknown",
                "username": tw.user.screen_name if hasattr(tw, "user") and tw.user and hasattr(tw.user, "screen_name") else None,
                "created_at": tw.created_at if hasattr(tw, "created_at") else None,
                "retweets": tw.retweet_count if hasattr(tw, "retweet_count") else 0,
                "likes": tw.favorite_count if hasattr(tw, "favorite_count") else 0,
                "views": tw.view_count if hasattr(tw, "view_count") else None,
            }
            tweets.append(tweet)
        cache_set("search", tweets, query, mode, count)
        return _output_search(tweets, query, as_json, count)
    except Exception as e:
        print(f"ERROR: Search failed: {e}", file=sys.stderr)
        sys.exit(1)

def _output_search(tweets, query, as_json, count):
    tweets = tweets[:count]
    if as_json:
        print(json.dumps(tweets, indent=2))
    else:
        print(f"X search results for \"{query}\" ({len(tweets)} tweets):\n")
        for i, tw in enumerate(tweets, 1):
            user = f"@{tw['username']}" if tw.get("username") else tw.get("user", "Unknown")
            stats = []
            if tw.get("retweets"):
                stats.append(f"{tw['retweets']} RT")
            if tw.get("likes"):
                stats.append(f"{tw['likes']} likes")
            if tw.get("views"):
                stats.append(f"{tw['views']} views")
            stat_str = f"  [{', '.join(stats)}]" if stats else ""
            text = tw.get("text", "").replace("\n", " ")[:200]
            print(f"  {i}. {user}: {text}{stat_str}")
            print()
    return tweets

async def cmd_user(username, show_tweets=False, count=10, as_json=False):
    """Get X user profile and optionally recent tweets."""
    cached = cache_get("user", username, show_tweets, count)
    if cached:
        return _output_user(cached, as_json)

    client = await get_client()
    if not client:
        print("ERROR: X authentication required for user lookup (set X_USERNAME, X_EMAIL, X_PASSWORD)", file=sys.stderr)
        sys.exit(1)

    try:
        user = await client.get_user_by_screen_name(username)
        profile = {
            "name": user.name if hasattr(user, "name") else username,
            "username": user.screen_name if hasattr(user, "screen_name") else username,
            "bio": user.description if hasattr(user, "description") else None,
            "followers": user.followers_count if hasattr(user, "followers_count") else None,
            "following": user.following_count if hasattr(user, "following_count") else None,
            "tweets_count": user.statuses_count if hasattr(user, "statuses_count") else None,
            "verified": user.is_blue_verified if hasattr(user, "is_blue_verified") else None,
            "created_at": user.created_at if hasattr(user, "created_at") else None,
            "location": user.location if hasattr(user, "location") else None,
        }

        recent_tweets = []
        if show_tweets:
            try:
                tweets_raw = await user.get_tweets("Tweets", count=count)
                for tw in tweets_raw:
                    recent_tweets.append({
                        "text": tw.text if hasattr(tw, "text") else str(tw),
                        "created_at": tw.created_at if hasattr(tw, "created_at") else None,
                        "retweets": tw.retweet_count if hasattr(tw, "retweet_count") else 0,
                        "likes": tw.favorite_count if hasattr(tw, "favorite_count") else 0,
                    })
            except Exception as e:
                print(f"Warning: Could not fetch tweets: {e}", file=sys.stderr)

        result = {"profile": profile, "recent_tweets": recent_tweets}
        cache_set("user", result, username, show_tweets, count)
        return _output_user(result, as_json)
    except Exception as e:
        print(f"ERROR: User lookup failed: {e}", file=sys.stderr)
        sys.exit(1)

def _output_user(data, as_json):
    if as_json:
        print(json.dumps(data, indent=2))
    else:
        p = data["profile"]
        print(f"@{p.get('username', '?')} — {p.get('name', '?')}")
        if p.get("bio"):
            print(f"Bio: {p['bio']}")
        if p.get("location"):
            print(f"Location: {p['location']}")
        parts = []
        if p.get("followers") is not None:
            parts.append(f"{p['followers']:,} followers")
        if p.get("following") is not None:
            parts.append(f"{p['following']:,} following")
        if p.get("tweets_count") is not None:
            parts.append(f"{p['tweets_count']:,} tweets")
        if parts:
            print(f"Stats: {' | '.join(parts)}")
        if p.get("verified"):
            print("Verified: Yes")

        if data.get("recent_tweets"):
            print(f"\nRecent tweets ({len(data['recent_tweets'])}):\n")
            for i, tw in enumerate(data["recent_tweets"], 1):
                text = tw.get("text", "").replace("\n", " ")[:200]
                stats = []
                if tw.get("retweets"):
                    stats.append(f"{tw['retweets']} RT")
                if tw.get("likes"):
                    stats.append(f"{tw['likes']} likes")
                stat_str = f"  [{', '.join(stats)}]" if stats else ""
                print(f"  {i}. {text}{stat_str}")
                print()
    return data

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="X/Twitter trends, search, and user profiles")
    sub = parser.add_subparsers(dest="command", required=True)

    # trends
    p_trends = sub.add_parser("trends", help="Get trending topics on X")
    p_trends.add_argument("--count", type=int, default=20, help="Number of trends (default: 20)")
    p_trends.add_argument("--json", action="store_true", dest="as_json", help="JSON output")
    p_trends.add_argument("--fallback-only", action="store_true", help="Skip twikit, use scrapers only")

    # search
    p_search = sub.add_parser("search", help="Search tweets on X")
    p_search.add_argument("query", help="Search query")
    p_search.add_argument("--mode", choices=["Top", "Latest"], default="Top", help="Search mode (default: Top)")
    p_search.add_argument("--count", type=int, default=10, help="Number of results (default: 10)")
    p_search.add_argument("--json", action="store_true", dest="as_json", help="JSON output")

    # user
    p_user = sub.add_parser("user", help="Get X user profile")
    p_user.add_argument("username", help="X username (without @)")
    p_user.add_argument("--tweets", action="store_true", help="Include recent tweets")
    p_user.add_argument("--count", type=int, default=10, help="Number of tweets (default: 10)")
    p_user.add_argument("--json", action="store_true", dest="as_json", help="JSON output")

    args = parser.parse_args()

    if args.command == "trends":
        asyncio.run(cmd_trends(count=args.count, as_json=args.as_json, fallback_only=args.fallback_only))
    elif args.command == "search":
        asyncio.run(cmd_search(query=args.query, mode=args.mode, count=args.count, as_json=args.as_json))
    elif args.command == "user":
        asyncio.run(cmd_user(username=args.username, show_tweets=args.tweets, count=args.count, as_json=args.as_json))

if __name__ == "__main__":
    main()
