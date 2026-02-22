#!/usr/bin/env python3
"""weather.py — Weather data from wttr.in (free, no API key)."""

import argparse
import json
import sys
import requests

def get_weather(location, forecast=False):
    fmt = "j1" if True else ""
    url = f"https://wttr.in/{location}?format=j1"
    resp = requests.get(url, headers={"User-Agent": "curl"}, timeout=10)
    resp.raise_for_status()
    return resp.json()

def main():
    parser = argparse.ArgumentParser(description="Weather lookup")
    parser.add_argument("location", nargs="+", help="City name")
    parser.add_argument("--forecast", action="store_true", help="Show 3-day forecast")
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()

    location = " ".join(args.location)
    try:
        data = get_weather(location, args.forecast)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    if args.as_json:
        print(json.dumps(data, indent=2))
        return

    current = data.get("current_condition", [{}])[0]
    area = data.get("nearest_area", [{}])[0]
    city = area.get("areaName", [{}])[0].get("value", location)
    country = area.get("country", [{}])[0].get("value", "")

    print(f"Weather: {city}, {country}")
    print(f"  Condition:  {current.get('weatherDesc', [{}])[0].get('value', '?')}")
    print(f"  Temp:       {current.get('temp_F', '?')}°F / {current.get('temp_C', '?')}°C")
    print(f"  Feels like: {current.get('FeelsLikeF', '?')}°F / {current.get('FeelsLikeC', '?')}°C")
    print(f"  Humidity:   {current.get('humidity', '?')}%")
    print(f"  Wind:       {current.get('windspeedMiles', '?')} mph {current.get('winddir16Point', '')}")
    print(f"  UV Index:   {current.get('uvIndex', '?')}")

    if args.forecast:
        print(f"\n3-Day Forecast:")
        for day in data.get("weather", [])[:3]:
            date = day.get("date", "?")
            high = day.get("maxtempF", "?")
            low = day.get("mintempF", "?")
            desc = day.get("hourly", [{}])[4].get("weatherDesc", [{}])[0].get("value", "?") if day.get("hourly") else "?"
            print(f"  {date}: {low}°F - {high}°F, {desc}")

if __name__ == "__main__":
    main()
