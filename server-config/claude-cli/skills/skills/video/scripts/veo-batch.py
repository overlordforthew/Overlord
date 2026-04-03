#!/usr/bin/env python3
"""Batch Veo video clip generation from a manifest file."""

import argparse
import json
import os
import sys
import time

from google import genai
from google.genai import types


def generate_clip(client, prompt, model, aspect_ratio, duration, output_path, index, total):
    """Generate a single Veo video clip."""
    print(f"\n--- Clip {index}/{total} ---")
    print(f"Prompt:   {prompt[:100]}{'...' if len(prompt) > 100 else ''}")
    print(f"Duration: {duration}s")

    config = types.GenerateVideosConfig(
        aspect_ratio=aspect_ratio,
        number_of_videos=1,
    )

    try:
        operation = client.models.generate_videos(
            model=model,
            prompt=prompt,
            config=config,
        )
    except Exception as e:
        err_str = str(e)
        if "RESOURCE_EXHAUSTED" in err_str or "429" in err_str:
            print(f"  QUOTA EXHAUSTED — skipping clip {index}", file=sys.stderr)
            return {"status": "quota_exhausted", "index": index}
        elif "INVALID_ARGUMENT" in err_str:
            print(f"  INVALID PROMPT — skipping clip {index}: {err_str[:100]}", file=sys.stderr)
            return {"status": "invalid", "index": index, "error": err_str[:200]}
        else:
            print(f"  ERROR — {err_str[:200]}", file=sys.stderr)
            return {"status": "error", "index": index, "error": err_str[:200]}

    print(f"  Waiting for generation...")
    elapsed = 0
    poll_interval = 15
    while not operation.done:
        time.sleep(poll_interval)
        elapsed += poll_interval
        mins, secs = divmod(elapsed, 60)
        print(f"  Still generating... ({mins}m {secs}s)")
        operation = client.operations.get(operation)

    if not operation.result or not operation.result.generated_videos:
        print(f"  No video generated for clip {index}", file=sys.stderr)
        return {"status": "empty", "index": index}

    video = operation.result.generated_videos[0]
    client.files.download(file=video.video)
    video.video.save(output_path)

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"  Saved: {output_path} ({size_mb:.1f} MB)")
    return {"status": "success", "index": index, "path": output_path, "size_mb": round(size_mb, 1)}


def main():
    parser = argparse.ArgumentParser(description="Batch generate Veo video clips")
    parser.add_argument("--manifest", required=True, help="Path to video manifest JSON")
    parser.add_argument("--output-dir", required=True, help="Directory for output clips")

    args = parser.parse_args()

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        print("Error: GOOGLE_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    with open(args.manifest) as f:
        manifest = json.load(f)

    segments = manifest["segments"]
    veo_config = manifest.get("veo", {})
    model = veo_config.get("model", "veo-3.0-generate-001")
    aspect_ratio = veo_config.get("aspect_ratio", "9:16")

    os.makedirs(args.output_dir, exist_ok=True)

    print(f"Generating {len(segments)} Veo clips")
    print(f"Model:  {model}")
    print(f"Aspect: {aspect_ratio}")

    client = genai.Client(api_key=api_key)
    results = []

    for i, seg in enumerate(segments, 1):
        prompt = seg["video_prompt"]
        duration = seg.get("duration", 8)
        output_path = os.path.join(args.output_dir, f"clip_{i:02d}.mp4")

        result = generate_clip(client, prompt, model, aspect_ratio, duration, output_path, i, len(segments))
        results.append(result)

        # If quota exhausted, stop generating more clips
        if result["status"] == "quota_exhausted":
            print(f"\nQuota exhausted after clip {i}. Stopping batch.")
            break

    # Summary
    success = sum(1 for r in results if r["status"] == "success")
    failed = len(results) - success
    skipped = len(segments) - len(results)

    print(f"\n=== Batch Complete ===")
    print(f"Success: {success}/{len(segments)}")
    if failed:
        print(f"Failed:  {failed}")
    if skipped:
        print(f"Skipped: {skipped} (quota)")

    summary = {
        "total": len(segments),
        "success": success,
        "failed": failed,
        "skipped": skipped,
        "clips": results,
    }
    print(f"\n__RESULT_JSON__:{json.dumps(summary)}")

    if success == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
