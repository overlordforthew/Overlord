#!/usr/bin/env python3
"""crypto.py — Live cryptocurrency prices from CoinGecko (free, no API key)."""

import argparse
import json
import sys
import requests

API_BASE = "https://api.coingecko.com/api/v3"

def get_prices(coins=None, top=10, vs="usd"):
    if coins:
        ids = ",".join(coins)
        url = f"{API_BASE}/simple/price?ids={ids}&vs_currencies={vs}&include_24hr_change=true&include_market_cap=true"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        return resp.json()
    else:
        url = f"{API_BASE}/coins/markets?vs_currency={vs}&order=market_cap_desc&per_page={top}&page=1&sparkline=false"
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        return resp.json()

def get_detail(coin_id):
    url = f"{API_BASE}/coins/{coin_id}?localization=false&tickers=false&community_data=false&developer_data=false"
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    return resp.json()

def format_num(n):
    if n is None:
        return "N/A"
    if abs(n) >= 1e9:
        return f"${n/1e9:.2f}B"
    if abs(n) >= 1e6:
        return f"${n/1e6:.2f}M"
    if abs(n) >= 1:
        return f"${n:,.2f}"
    return f"${n:.6f}"

def main():
    parser = argparse.ArgumentParser(description="Crypto prices")
    parser.add_argument("coins", nargs="*", help="Coin IDs (e.g., bitcoin ethereum)")
    parser.add_argument("--top", type=int, default=10, help="Top N by market cap")
    parser.add_argument("--detail", action="store_true", help="Detailed info for a single coin")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    try:
        if args.detail and args.coins:
            data = get_detail(args.coins[0])
            if args.as_json:
                print(json.dumps(data, indent=2))
            else:
                md = data.get("market_data", {})
                price = md.get("current_price", {}).get("usd", 0)
                change24 = md.get("price_change_percentage_24h", 0)
                change7d = md.get("price_change_percentage_7d", 0)
                mcap = md.get("market_cap", {}).get("usd", 0)
                vol = md.get("total_volume", {}).get("usd", 0)
                ath = md.get("ath", {}).get("usd", 0)
                rank = data.get("market_cap_rank", "?")
                print(f"{data['name']} ({data['symbol'].upper()}) — Rank #{rank}")
                print(f"  Price:    {format_num(price)}")
                print(f"  24h:      {change24:+.2f}%")
                print(f"  7d:       {change7d:+.2f}%")
                print(f"  MCap:     {format_num(mcap)}")
                print(f"  Volume:   {format_num(vol)}")
                print(f"  ATH:      {format_num(ath)}")
                desc = data.get("description", {}).get("en", "")
                if desc:
                    clean = desc.replace("<a ", "").replace("</a>", "")[:200]
                    print(f"  About:    {clean}...")
        elif args.coins:
            data = get_prices(coins=args.coins)
            if args.as_json:
                print(json.dumps(data, indent=2))
            else:
                for coin_id, info in data.items():
                    price = info.get("usd", 0)
                    change = info.get("usd_24h_change", 0)
                    mcap = info.get("usd_market_cap", 0)
                    arrow = "+" if change and change > 0 else ""
                    print(f"{coin_id:20s} {format_num(price):>12s}  {arrow}{change:.2f}%  MCap: {format_num(mcap)}")
        else:
            data = get_prices(top=args.top)
            if args.as_json:
                print(json.dumps(data, indent=2))
            else:
                print(f"{'#':>3s}  {'Coin':20s} {'Price':>12s}  {'24h':>8s}  {'Market Cap':>12s}")
                print("-" * 65)
                for coin in data:
                    rank = coin.get("market_cap_rank", "?")
                    name = coin.get("name", "?")
                    sym = coin.get("symbol", "?").upper()
                    price = coin.get("current_price", 0)
                    change = coin.get("price_change_percentage_24h", 0) or 0
                    mcap = coin.get("market_cap", 0)
                    arrow = "+" if change > 0 else ""
                    print(f"{rank:>3}  {name:20s} {format_num(price):>12s}  {arrow}{change:>6.2f}%  {format_num(mcap):>12s}")
    except requests.exceptions.HTTPError as e:
        if e.response.status_code == 429:
            print("Rate limited by CoinGecko — wait a minute and try again", file=sys.stderr)
        else:
            print(f"API error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
