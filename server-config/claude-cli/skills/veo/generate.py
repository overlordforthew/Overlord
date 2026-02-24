#!/usr/bin/env python3
"""Google Veo video generation script for Claude Code skill."""

import argparse
import json
import os
import sys
import time

from google import genai
from google.genai import types


def main():
    parser = argparse.ArgumentParser(description="Generate video with Google Veo")
    parser.add_argument("prompt", help="Text prompt describing the video")
    parser.add_argument("--model", default="veo-3.0-generate-001",
                        choices=[
                            "veo-2.0-generate-001",
                            "veo-3.0-generate-001",
                            "veo-3.0-fast-generate-001",
                            "veo-3.1-generate-preview",
                            "veo-3.1-fast-generate-preview",
                        ],
                        help="Veo model to use (default: veo-3.0-generate-001)")
    parser.add_argument("--aspect-ratio", default="16:9", choices=["16:9", "9:16"],
                        help="Aspect ratio (default: 16:9)")
    parser.add_argument("--duration", type=int, default=8, choices=[4, 5, 6, 7, 8],
                        help="Duration in seconds (default: 8)")
    parser.add_argument("--output", "-o", default=None,
                        help="Output file path (default: auto-generated in /root/videos/)")
    parser.add_argument("--negative-prompt", default=None,
                        help="What to avoid in the video")
    parser.add_argument("--audio", action="store_true", default=False,
                        help="Generate audio (Veo 3+ only)")
    parser.add_argument("--image", default=None,
                        help="Path to reference image for image-to-video")
    parser.add_argument("--poll-interval", type=int, default=15,
                        help="Seconds between status checks (default: 15)")

    args = parser.parse_args()

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GOOGLE_API_KEY environment variable not set", file=sys.stderr)
        sys.exit(1)

    # Set up output path
    os.makedirs("/root/videos", exist_ok=True)
    if args.output:
        output_path = args.output
    else:
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        safe_name = args.prompt[:40].replace(" ", "_").replace("/", "-")
        output_path = f"/root/videos/{timestamp}_{safe_name}.mp4"

    print(f"Model:    {args.model}")
    print(f"Prompt:   {args.prompt}")
    print(f"Aspect:   {args.aspect_ratio}")
    print(f"Duration: {args.duration}s")
    if args.negative_prompt:
        print(f"Negative: {args.negative_prompt}")
    if args.audio:
        print(f"Audio:    enabled")
    if args.image:
        print(f"Image:    {args.image}")
    print(f"Output:   {output_path}")
    print()

    client = genai.Client(api_key=api_key)

    # Build config
    config_kwargs = {
        "aspect_ratio": args.aspect_ratio,
        "number_of_videos": 1,
    }
    if args.negative_prompt:
        config_kwargs["negative_prompt"] = args.negative_prompt
    # Note: generate_audio is only supported on Vertex AI, not Gemini API
    # Audio is automatically included in Veo 3+ outputs via Gemini API

    config = types.GenerateVideosConfig(**config_kwargs)

    # Build generation kwargs
    gen_kwargs = {
        "model": args.model,
        "prompt": args.prompt,
        "config": config,
    }

    # Handle image-to-video
    if args.image:
        with open(args.image, "rb") as f:
            image_bytes = f.read()
        ext = os.path.splitext(args.image)[1].lower()
        mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
        mime = mime_map.get(ext, "image/png")
        gen_kwargs["image"] = types.Image(image_bytes=image_bytes, mime_type=mime)

    print("Submitting video generation request...")
    try:
        operation = client.models.generate_videos(**gen_kwargs)
    except Exception as e:
        err_str = str(e)
        if "RESOURCE_EXHAUSTED" in err_str or "429" in err_str:
            print("Error: Daily free tier quota exhausted. Try again tomorrow or upgrade to a paid plan.", file=sys.stderr)
            print(f"\n__RESULT_JSON__:{json.dumps({'status': 'quota_exhausted', 'error': 'Daily free tier limit reached'})}")
            sys.exit(1)
        elif "INVALID_ARGUMENT" in err_str:
            print(f"Error: Invalid request — {err_str}", file=sys.stderr)
            print(f"\n__RESULT_JSON__:{json.dumps({'status': 'error', 'error': err_str[:200]})}")
            sys.exit(1)
        else:
            raise

    print("Waiting for video generation to complete...")
    elapsed = 0
    while not operation.done:
        time.sleep(args.poll_interval)
        elapsed += args.poll_interval
        mins, secs = divmod(elapsed, 60)
        print(f"  Still generating... ({mins}m {secs}s elapsed)")
        operation = client.operations.get(operation)

    print()

    if not operation.result or not operation.result.generated_videos:
        print("Error: No video was generated.", file=sys.stderr)
        if hasattr(operation, 'error') and operation.error:
            print(f"Error details: {operation.error}", file=sys.stderr)
        sys.exit(1)

    video = operation.result.generated_videos[0]
    client.files.download(file=video.video)
    video.video.save(output_path)

    file_size = os.path.getsize(output_path)
    size_mb = file_size / (1024 * 1024)

    print(f"Video saved to: {output_path}")
    print(f"File size: {size_mb:.1f} MB")
    print("Done!")

    # Output JSON summary for Claude to parse
    result = {
        "status": "success",
        "output_path": output_path,
        "file_size_mb": round(size_mb, 1),
        "model": args.model,
        "prompt": args.prompt,
        "duration_seconds": args.duration,
        "aspect_ratio": args.aspect_ratio,
    }
    print(f"\n__RESULT_JSON__:{json.dumps(result)}")


if __name__ == "__main__":
    main()
