#!/usr/bin/env python3
"""amadeus.py — Flight, hotel, and POI search via Amadeus Self-Service API."""

import argparse
import json
import os
import sys
import time
import requests

# --- Auth ---

TOKEN_CACHE = "/tmp/amadeus_token.json"
AUTH_URL = "https://test.api.amadeus.com/v1/security/oauth2/token"
API_BASE = "https://test.api.amadeus.com"


def get_token():
    """Get OAuth2 token, using cache if still valid."""
    if os.path.exists(TOKEN_CACHE):
        with open(TOKEN_CACHE) as f:
            cached = json.load(f)
        if cached.get("expires_at", 0) > time.time() + 60:
            return cached["access_token"]

    client_id = os.environ.get("AMADEUS_CLIENT_ID")
    client_secret = os.environ.get("AMADEUS_CLIENT_SECRET")
    if not client_id or not client_secret:
        print("Error: AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET env vars required.", file=sys.stderr)
        print("Register at developers.amadeus.com to get credentials.", file=sys.stderr)
        sys.exit(1)

    resp = requests.post(AUTH_URL, data={
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    }, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    data["expires_at"] = time.time() + data.get("expires_in", 1799)
    with open(TOKEN_CACHE, "w") as f:
        json.dump(data, f)

    return data["access_token"]


def api_get(path, params):
    """Authenticated GET request to Amadeus API."""
    token = get_token()
    resp = requests.get(
        f"{API_BASE}{path}",
        params=params,
        headers={"Authorization": f"Bearer {token}"},
        timeout=30,
    )
    if resp.status_code == 401:
        # Token expired, clear cache and retry once
        if os.path.exists(TOKEN_CACHE):
            os.remove(TOKEN_CACHE)
        token = get_token()
        resp = requests.get(
            f"{API_BASE}{path}",
            params=params,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
    if resp.status_code == 429:
        print("Rate limited by Amadeus — free tier allows ~2,000 requests/month.", file=sys.stderr)
        sys.exit(1)
    resp.raise_for_status()
    return resp.json()


# --- Flight Search ---

def search_flights(origin, destination, date, return_date=None, adults=1, travel_class=None, nonstop=False):
    """Search flights using Amadeus Flight Offers Search v2."""
    params = {
        "originLocationCode": origin.upper(),
        "destinationLocationCode": destination.upper(),
        "departureDate": date,
        "adults": adults,
        "max": 10,
        "currencyCode": "USD",
    }
    if return_date:
        params["returnDate"] = return_date
    if travel_class:
        class_map = {
            "economy": "ECONOMY",
            "premium": "PREMIUM_ECONOMY",
            "business": "BUSINESS",
            "first": "FIRST",
        }
        params["travelClass"] = class_map.get(travel_class.lower(), travel_class.upper())
    if nonstop:
        params["nonStop"] = "true"

    data = api_get("/v2/shopping/flight-offers", params)
    return data.get("data", [])


def format_flights(offers, as_json=False):
    """Format flight offers for display."""
    if as_json:
        print(json.dumps(offers, indent=2))
        return

    if not offers:
        print("No flights found for this route/date.")
        return

    print(f"Found {len(offers)} flight offer(s):\n")
    for i, offer in enumerate(offers, 1):
        price = offer.get("price", {})
        total = price.get("grandTotal", price.get("total", "?"))
        currency = price.get("currency", "USD")

        itineraries = offer.get("itineraries", [])
        for j, itin in enumerate(itineraries):
            direction = "Outbound" if j == 0 else "Return"
            segments = itin.get("segments", [])
            duration = itin.get("duration", "").replace("PT", "").lower()

            stops = len(segments) - 1
            stop_text = "Direct" if stops == 0 else f"{stops} stop{'s' if stops > 1 else ''}"

            first_seg = segments[0]
            last_seg = segments[-1]
            dep = first_seg.get("departure", {})
            arr = last_seg.get("arrival", {})

            dep_time = dep.get("at", "?")[:16].replace("T", " ")
            arr_time = arr.get("at", "?")[:16].replace("T", " ")
            dep_code = dep.get("iataCode", "?")
            arr_code = arr.get("iataCode", "?")

            carriers = []
            for seg in segments:
                carrier = seg.get("carrierCode", "?")
                flight_num = seg.get("number", "")
                carriers.append(f"{carrier}{flight_num}")

            if j == 0:
                print(f"  [{i}] {currency} {total}")
            print(f"      {direction}: {dep_code} {dep_time} → {arr_code} {arr_time}")
            print(f"      {' → '.join(carriers)} | {duration} | {stop_text}")

        print()


# --- Hotel Search ---

def search_hotels(city_code, check_in, check_out, adults=1, rooms=1, ratings=None):
    """Search hotels using Amadeus Hotel List + Hotel Offers."""
    # Step 1: get hotel IDs in the city
    list_params = {"cityCode": city_code.upper()}
    if ratings:
        list_params["ratings"] = ",".join(str(r) for r in ratings)

    hotel_data = api_get("/v1/reference-data/locations/hotels/by-city", list_params)
    hotels = hotel_data.get("data", [])

    if not hotels:
        return []

    # Step 2: get offers for top hotels (API limit: 20 hotel IDs per request)
    hotel_ids = [h["hotelId"] for h in hotels[:20]]
    offer_params = {
        "hotelIds": ",".join(hotel_ids),
        "checkInDate": check_in,
        "checkOutDate": check_out,
        "adults": adults,
        "roomQuantity": rooms,
        "currency": "USD",
    }

    try:
        offer_data = api_get("/v3/shopping/hotel-offers", offer_params)
        return offer_data.get("data", [])
    except requests.exceptions.HTTPError as e:
        # Hotel offers API can be flaky — fall back to just hotel list
        if e.response is not None and e.response.status_code in (400, 500):
            return [{"hotel": h, "offers": []} for h in hotels[:10]]
        raise


def format_hotels(results, as_json=False):
    """Format hotel results for display."""
    if as_json:
        print(json.dumps(results, indent=2))
        return

    if not results:
        print("No hotels found for this city/dates.")
        return

    print(f"Found {len(results)} hotel(s):\n")
    for i, item in enumerate(results[:10], 1):
        hotel = item.get("hotel", {})
        name = hotel.get("name", "Unknown")
        hotel_id = hotel.get("hotelId", "?")
        rating = hotel.get("rating", "")
        city = hotel.get("cityCode", "")

        rating_str = f" {'*' * int(rating)}" if rating else ""

        offers = item.get("offers", [])
        if offers:
            offer = offers[0]
            price_info = offer.get("price", {})
            total = price_info.get("total", "?")
            currency = price_info.get("currency", "USD")
            room = offer.get("room", {})
            room_type = room.get("typeEstimated", {}).get("category", "")
            beds = room.get("typeEstimated", {}).get("beds", "")
            bed_type = room.get("typeEstimated", {}).get("bedType", "")
            room_desc = " | ".join(filter(None, [room_type, f"{beds} {bed_type}".strip() if beds else ""]))

            print(f"  [{i}] {name}{rating_str} ({city})")
            print(f"      {currency} {total}{' | ' + room_desc if room_desc else ''}")
        else:
            lat = hotel.get("latitude", "")
            lon = hotel.get("longitude", "")
            loc = f" ({lat}, {lon})" if lat and lon else ""
            print(f"  [{i}] {name}{rating_str} ({city}){loc}")
            print(f"      ID: {hotel_id} — no pricing available")

        print()


# --- Points of Interest ---

def search_poi(lat, lon, radius=1, category=None):
    """Search points of interest near coordinates."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "radius": radius,
    }
    if category:
        params["categories"] = category.upper()

    data = api_get("/v1/reference-data/locations/pois", params)
    return data.get("data", [])


def format_poi(pois, as_json=False):
    """Format POI results for display."""
    if as_json:
        print(json.dumps(pois, indent=2))
        return

    if not pois:
        print("No points of interest found for this location.")
        return

    print(f"Found {len(pois)} point(s) of interest:\n")
    for i, poi in enumerate(pois[:15], 1):
        name = poi.get("name", "Unknown")
        category = poi.get("category", "").replace("_", " ").title()
        tags = poi.get("tags", [])
        rank = poi.get("rank", "")

        tag_str = ", ".join(tags[:3]) if tags else ""
        rank_str = f" (rank {rank})" if rank else ""

        geo = poi.get("geoCode", {})
        lat = geo.get("latitude", "")
        lon = geo.get("longitude", "")

        print(f"  [{i}] {name}")
        print(f"      {category}{rank_str}")
        if tag_str:
            print(f"      Tags: {tag_str}")
        print()


# --- IATA Lookup ---

def lookup_iata(keyword):
    """Look up IATA codes by city/airport name."""
    params = {
        "subType": "CITY,AIRPORT",
        "keyword": keyword,
        "page[limit]": 10,
    }
    data = api_get("/v1/reference-data/locations", params)
    return data.get("data", [])


def format_iata(locations, as_json=False):
    """Format IATA lookup results for display."""
    if as_json:
        print(json.dumps(locations, indent=2))
        return

    if not locations:
        print(f"No IATA codes found.")
        return

    print("IATA Code Results:\n")
    for loc in locations:
        code = loc.get("iataCode", "?")
        name = loc.get("name", "?")
        sub_type = loc.get("subType", "").title()
        city = loc.get("address", {}).get("cityName", "")
        country = loc.get("address", {}).get("countryCode", "")

        detail = loc.get("detailedName", "")
        parts = [sub_type]
        if city and city.upper() != name.upper():
            parts.append(city)
        if country:
            parts.append(country)

        print(f"  {code:6s} {name} — {', '.join(parts)}")


# --- Main ---

def main():
    parser = argparse.ArgumentParser(
        description="Amadeus Travel — flights, hotels, POI, IATA lookup",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""Examples:
  %(prog)s flight CDG JFK 2026-04-01
  %(prog)s flight CDG JFK 2026-04-01 --return 2026-04-08 --adults 2
  %(prog)s hotel PAR 2026-04-01 2026-04-03
  %(prog)s poi 48.8566 2.3522 --category RESTAURANT
  %(prog)s iata "New York"
""",
    )
    sub = parser.add_subparsers(dest="command", help="Command")

    # flight
    fp = sub.add_parser("flight", help="Search flights")
    fp.add_argument("origin", help="Origin IATA code (e.g. CDG, MIA)")
    fp.add_argument("destination", help="Destination IATA code (e.g. JFK, LAX)")
    fp.add_argument("date", help="Departure date (YYYY-MM-DD)")
    fp.add_argument("--return", dest="return_date", help="Return date for round-trip (YYYY-MM-DD)")
    fp.add_argument("--adults", type=int, default=1, help="Number of adults (default: 1)")
    fp.add_argument("--class", dest="travel_class", help="Cabin class: economy, premium, business, first")
    fp.add_argument("--nonstop", action="store_true", help="Direct flights only")
    fp.add_argument("--json", action="store_true", dest="as_json", help="JSON output")

    # hotel
    hp = sub.add_parser("hotel", help="Search hotels")
    hp.add_argument("city", help="City IATA code (e.g. PAR, NYC, LON)")
    hp.add_argument("check_in", help="Check-in date (YYYY-MM-DD)")
    hp.add_argument("check_out", help="Check-out date (YYYY-MM-DD)")
    hp.add_argument("--adults", type=int, default=1, help="Number of adults (default: 1)")
    hp.add_argument("--rooms", type=int, default=1, help="Number of rooms (default: 1)")
    hp.add_argument("--ratings", type=int, nargs="+", help="Star ratings to filter (e.g. 4 5)")
    hp.add_argument("--json", action="store_true", dest="as_json", help="JSON output")

    # poi
    pp = sub.add_parser("poi", help="Points of interest")
    pp.add_argument("lat", type=float, help="Latitude")
    pp.add_argument("lon", type=float, help="Longitude")
    pp.add_argument("--radius", type=int, default=1, help="Search radius in km (default: 1)")
    pp.add_argument("--category", help="Category: SIGHTS, RESTAURANT, SHOPPING, NIGHTLIFE, BEACH_PARK")
    pp.add_argument("--json", action="store_true", dest="as_json", help="JSON output")

    # iata
    ip = sub.add_parser("iata", help="Look up IATA codes")
    ip.add_argument("keyword", help="City or airport name to search")
    ip.add_argument("--json", action="store_true", dest="as_json", help="JSON output")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    try:
        if args.command == "flight":
            offers = search_flights(
                args.origin, args.destination, args.date,
                return_date=args.return_date,
                adults=args.adults,
                travel_class=args.travel_class,
                nonstop=args.nonstop,
            )
            format_flights(offers, args.as_json)

        elif args.command == "hotel":
            results = search_hotels(
                args.city, args.check_in, args.check_out,
                adults=args.adults,
                rooms=args.rooms,
                ratings=args.ratings,
            )
            format_hotels(results, args.as_json)

        elif args.command == "poi":
            pois = search_poi(args.lat, args.lon, radius=args.radius, category=args.category)
            format_poi(pois, args.as_json)

        elif args.command == "iata":
            locations = lookup_iata(args.keyword)
            format_iata(locations, args.as_json)

    except requests.exceptions.HTTPError as e:
        status = e.response.status_code if e.response is not None else "?"
        body = ""
        if e.response is not None:
            try:
                body = e.response.json().get("errors", [{}])[0].get("detail", "")
            except Exception:
                body = e.response.text[:200]
        print(f"Amadeus API error ({status}): {body or e}", file=sys.stderr)
        sys.exit(1)
    except requests.exceptions.ConnectionError:
        print("Connection error — check network or Amadeus API status.", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
