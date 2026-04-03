#!/usr/bin/env python3
"""TTS wrapper supporting Kokoro and Edge-TTS engines."""

import argparse
import asyncio
import json
import os
import sys
import urllib.request
import urllib.error


def kokoro_tts(text, voice, speed, output):
    """Generate speech via Kokoro TTS (OpenAI-compatible API on ElmoServer)."""
    url = os.environ.get("KOKORO_API_URL", "http://100.89.16.27:8880")
    endpoint = f"{url}/v1/audio/speech"

    payload = json.dumps({
        "model": "kokoro",
        "voice": voice,
        "input": text,
        "speed": speed,
    }).encode()

    req = urllib.request.Request(
        endpoint,
        data=payload,
        headers={"Content-Type": "application/json"},
    )

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            with open(output, "wb") as f:
                f.write(resp.read())
    except urllib.error.HTTPError as e:
        print(f"Kokoro API error: {e.code} {e.read().decode()[:200]}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Kokoro connection failed: {e.reason}", file=sys.stderr)
        print("Is ElmoServer running? Check http://100.89.16.27:8880", file=sys.stderr)
        sys.exit(1)


def edge_tts_generate(text, voice, speed, output):
    """Generate speech via Edge-TTS (free Microsoft voices)."""
    import edge_tts

    rate_str = ""
    if speed != 1.0:
        pct = int((speed - 1.0) * 100)
        rate_str = f"+{pct}%" if pct >= 0 else f"{pct}%"

    async def _generate():
        communicate = edge_tts.Communicate(text, voice, rate=rate_str if rate_str else "+0%")
        await communicate.save(output)

    asyncio.run(_generate())


def main():
    parser = argparse.ArgumentParser(description="Generate TTS audio")
    parser.add_argument("--engine", default="kokoro", choices=["kokoro", "edge"],
                        help="TTS engine (default: kokoro)")
    parser.add_argument("--voice", default=None,
                        help="Voice ID (default: af_bella for kokoro, en-US-AriaNeural for edge)")
    parser.add_argument("--speed", type=float, default=1.0,
                        help="Speech speed multiplier (default: 1.0)")
    parser.add_argument("--text", default=None, help="Text to speak")
    parser.add_argument("--text-file", default=None, help="File containing text to speak")
    parser.add_argument("--output", "-o", required=True, help="Output audio file path")

    args = parser.parse_args()

    # Get text
    if args.text_file:
        with open(args.text_file) as f:
            text = f.read().strip()
    elif args.text:
        text = args.text
    else:
        print("Error: provide --text or --text-file", file=sys.stderr)
        sys.exit(1)

    if not text:
        print("Error: empty text", file=sys.stderr)
        sys.exit(1)

    # Default voices per engine
    voice = args.voice
    if not voice:
        voice = "af_bella" if args.engine == "kokoro" else "en-US-AriaNeural"

    print(f"Engine: {args.engine}")
    print(f"Voice:  {voice}")
    print(f"Speed:  {args.speed}")
    print(f"Text:   {text[:80]}{'...' if len(text) > 80 else ''}")
    print(f"Output: {args.output}")

    if args.engine == "kokoro":
        kokoro_tts(text, voice, args.speed, args.output)
    elif args.engine == "edge":
        edge_tts_generate(text, voice, args.speed, args.output)

    size_kb = os.path.getsize(args.output) / 1024
    print(f"Generated: {args.output} ({size_kb:.0f} KB)")
    print(json.dumps({"status": "success", "output": args.output, "size_kb": round(size_kb)}))


if __name__ == "__main__":
    main()
