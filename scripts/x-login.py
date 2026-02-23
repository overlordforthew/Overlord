#!/usr/bin/env python3
"""Run this on your LOCAL machine (not the server) to generate X cookies.

Usage:
  pip install twikit
  python3 x-login.py

Then copy the output file to the server:
  scp x_cookies.json gil@100.83.80.116:/tmp/x_cookies.json
"""

import asyncio

async def main():
    from twikit import Client

    username = input("X username (without @): ").strip()
    email = input("X email: ").strip()
    password = input("X password: ").strip()

    print("\nLogging in to X...")
    client = Client("en-US")
    await client.login(auth_info_1=username, auth_info_2=email, password=password)
    client.save_cookies("x_cookies.json")
    print("\nSuccess! Cookies saved to x_cookies.json")
    print("\nNow copy to server:")
    print("  scp x_cookies.json gil@100.83.80.116:/tmp/x_cookies.json")

if __name__ == "__main__":
    asyncio.run(main())
