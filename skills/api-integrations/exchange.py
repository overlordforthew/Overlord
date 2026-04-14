#!/usr/bin/env python3
"""exchange.py — Currency exchange rates (free API, no key needed)."""

import argparse
import json
import sys
import requests

API_URL = "https://open.er-api.com/v6/latest"

def get_rates(base="USD"):
    resp = requests.get(f"{API_URL}/{base}", timeout=10)
    resp.raise_for_status()
    data = resp.json()
    if data.get("result") != "success":
        raise Exception(f"API error: {data}")
    return data

def main():
    parser = argparse.ArgumentParser(description="Currency exchange rates")
    parser.add_argument("args", nargs="*", help="[amount] FROM TO  (e.g., '100 USD EUR' or 'USD TTD')")
    parser.add_argument("--list", action="store_true", help="List available currencies")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    if args.list:
        data = get_rates("USD")
        currencies = sorted(data["rates"].keys())
        for i in range(0, len(currencies), 10):
            print("  ".join(f"{c:5s}" for c in currencies[i:i+10]))
        return

    parts = args.args
    if len(parts) == 2:
        amount, from_cur, to_cur = 1.0, parts[0].upper(), parts[1].upper()
    elif len(parts) == 3:
        try:
            amount = float(parts[0])
            from_cur, to_cur = parts[1].upper(), parts[2].upper()
        except ValueError:
            amount, from_cur, to_cur = 1.0, parts[0].upper(), parts[1].upper()
    else:
        print("Usage: exchange.py [amount] FROM TO")
        print("Example: exchange.py 100 USD EUR")
        sys.exit(1)

    try:
        data = get_rates(from_cur)
        rate = data["rates"].get(to_cur)
        if rate is None:
            print(f"Unknown currency: {to_cur}", file=sys.stderr)
            sys.exit(1)

        result = amount * rate
        if args.as_json:
            print(json.dumps({"from": from_cur, "to": to_cur, "amount": amount,
                             "rate": rate, "result": result}))
        else:
            print(f"{amount:,.2f} {from_cur} = {result:,.2f} {to_cur}")
            print(f"Rate: 1 {from_cur} = {rate:,.4f} {to_cur}")
            print(f"Updated: {data.get('time_last_update_utc', '?')}")
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
