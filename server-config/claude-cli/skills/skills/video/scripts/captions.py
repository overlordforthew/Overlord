#!/usr/bin/env python3
"""Generate ASS subtitles from audio using Groq Whisper word-level timestamps."""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
import mimetypes
import uuid


def transcribe_word_level(audio_path, api_key):
    """Send audio to Groq Whisper and get word-level timestamps."""
    boundary = uuid.uuid4().hex
    filename = os.path.basename(audio_path)
    mime_type = mimetypes.guess_type(audio_path)[0] or "audio/mpeg"

    with open(audio_path, "rb") as f:
        audio_data = f.read()

    # Build multipart form data manually
    parts = []

    # File part
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode())
    parts.append(f"Content-Type: {mime_type}\r\n\r\n".encode())
    parts.append(audio_data)
    parts.append(b"\r\n")

    # Model part
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="model"\r\n\r\n')
    parts.append(b"whisper-large-v3-turbo\r\n")

    # Response format
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="response_format"\r\n\r\n')
    parts.append(b"verbose_json\r\n")

    # Timestamp granularities - word level
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n')
    parts.append(b"word\r\n")

    # Closing boundary
    parts.append(f"--{boundary}--\r\n".encode())

    body = b"".join(parts)

    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "Videopipeline/1.0",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:300]
        print(f"Groq API error: {e.code} {err}", file=sys.stderr)
        sys.exit(1)


def words_to_ass(words, output_path):
    """Convert word-level timestamps to ASS subtitle format.

    Groups 2-3 words per subtitle line for readability.
    """
    # ASS header
    header = """[Script Info]
Title: Video Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,58,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,350,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    def fmt_time(seconds):
        """Format seconds to ASS time: H:MM:SS.CC"""
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = seconds % 60
        return f"{h}:{m:02d}:{s:05.2f}"

    # Group words into chunks of 2-3 for readability
    events = []
    i = 0
    while i < len(words):
        # Take 2-3 words per line
        chunk_size = 3 if i + 3 <= len(words) else min(2, len(words) - i)
        chunk = words[i:i + chunk_size]

        start = chunk[0]["start"]
        end = chunk[-1]["end"]
        text = " ".join(w["word"] for w in chunk)

        # Ensure minimum display time of 0.3s
        if end - start < 0.3:
            end = start + 0.3

        events.append(f"Dialogue: 0,{fmt_time(start)},{fmt_time(end)},Default,,0,0,0,,{text}")
        i += chunk_size

    with open(output_path, "w") as f:
        f.write(header)
        f.write("\n".join(events))
        f.write("\n")


def segments_to_ass(segments, output_path):
    """Fallback: use segment-level timestamps if word-level unavailable."""
    header = """[Script Info]
Title: Video Captions
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,58,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,350,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    def fmt_time(seconds):
        h = int(seconds // 3600)
        m = int((seconds % 3600) // 60)
        s = seconds % 60
        return f"{h}:{m:02d}:{s:05.2f}"

    events = []
    for seg in segments:
        text = seg.get("text", "").strip()
        if not text:
            continue
        start = seg["start"]
        end = seg["end"]
        events.append(f"Dialogue: 0,{fmt_time(start)},{fmt_time(end)},Default,,0,0,0,,{text}")

    with open(output_path, "w") as f:
        f.write(header)
        f.write("\n".join(events))
        f.write("\n")


def main():
    parser = argparse.ArgumentParser(description="Generate ASS captions from audio")
    parser.add_argument("--audio", required=True, help="Input audio file")
    parser.add_argument("--output", "-o", required=True, help="Output .ass file path")

    args = parser.parse_args()

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        print("Error: GROQ_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.audio):
        print(f"Error: audio file not found: {args.audio}", file=sys.stderr)
        sys.exit(1)

    print(f"Transcribing: {args.audio}")
    result = transcribe_word_level(args.audio, api_key)

    # Try word-level first, fall back to segments
    words = result.get("words", [])
    if words:
        print(f"Got {len(words)} word-level timestamps")
        words_to_ass(words, args.output)
    elif result.get("segments"):
        print("Word-level unavailable, using segment-level timestamps")
        segments_to_ass(result["segments"], args.output)
    else:
        print("Error: no timestamps returned from Whisper", file=sys.stderr)
        sys.exit(1)

    print(f"Captions saved to: {args.output}")
    print(json.dumps({"status": "success", "output": args.output, "word_count": len(words)}))


if __name__ == "__main__":
    main()
