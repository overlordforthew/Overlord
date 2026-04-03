#!/usr/bin/env python3
"""Video pipeline orchestrator: TTS → captions → Veo clips → assemble."""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import uuid


SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))


def run_stage(name, cmd, timeout=600):
    """Run a pipeline stage and return success/failure."""
    print(f"\n{'='*50}")
    print(f"STAGE: {name}")
    print(f"{'='*50}")

    result = subprocess.run(
        cmd, capture_output=False, text=True, timeout=timeout
    )

    if result.returncode != 0:
        print(f"\nSTAGE FAILED: {name}", file=sys.stderr)
        return False

    print(f"STAGE COMPLETE: {name}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Run video pipeline from manifest")
    parser.add_argument("--manifest", required=True, help="Path to manifest JSON")

    args = parser.parse_args()

    with open(args.manifest) as f:
        manifest = json.load(f)

    topic = manifest.get("topic", "video")
    voice = manifest.get("voice", {})
    veo = manifest.get("veo", {})
    music = manifest.get("music", {})
    output_config = manifest.get("output", {})

    # Set up working directory
    work_id = uuid.uuid4().hex[:8]
    work_dir = f"/tmp/video-pipeline-{work_id}"
    os.makedirs(work_dir, exist_ok=True)

    # Set up output
    output_dir = output_config.get("dir", "/root/videos/shorts/")
    os.makedirs(output_dir, exist_ok=True)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    safe_topic = topic[:40].replace(" ", "_").replace("/", "-").replace("'", "").replace('"', "")
    filename = output_config.get("filename") or f"{timestamp}_{safe_topic}.mp4"
    output_path = os.path.join(output_dir, filename)

    clips_dir = os.path.join(work_dir, "clips")
    os.makedirs(clips_dir, exist_ok=True)

    audio_path = os.path.join(work_dir, "voiceover.mp3")
    captions_path = os.path.join(work_dir, "captions.ass")

    # Write full script text for TTS
    script_text = manifest.get("script", "")
    if not script_text:
        script_text = " ".join(seg["text"] for seg in manifest["segments"])
    script_file = os.path.join(work_dir, "script.txt")
    with open(script_file, "w") as f:
        f.write(script_text)

    print(f"Topic:      {topic}")
    print(f"Segments:   {len(manifest['segments'])}")
    print(f"Voice:      {voice.get('engine', 'kokoro')} / {voice.get('voice_id', 'af_bella')}")
    print(f"Veo model:  {veo.get('model', 'veo-3.0-generate-001')}")
    print(f"Work dir:   {work_dir}")
    print(f"Output:     {output_path}")

    start_time = time.time()

    # Stage 1: TTS
    tts_cmd = [
        sys.executable, os.path.join(SCRIPTS_DIR, "tts.py"),
        "--engine", voice.get("engine", "kokoro"),
        "--voice", voice.get("voice_id", "af_bella"),
        "--speed", str(voice.get("speed", 1.0)),
        "--text-file", script_file,
        "--output", audio_path,
    ]
    if not run_stage("TTS Voiceover", tts_cmd, timeout=180):
        print("Pipeline failed at TTS stage", file=sys.stderr)
        sys.exit(1)

    # Stage 2: Captions
    captions_cmd = [
        sys.executable, os.path.join(SCRIPTS_DIR, "captions.py"),
        "--audio", audio_path,
        "--output", captions_path,
    ]
    if not run_stage("Caption Generation", captions_cmd, timeout=120):
        print("Warning: caption generation failed, continuing without captions", file=sys.stderr)
        captions_path = None

    # Stage 3: Veo clips (longest stage)
    veo_cmd = [
        sys.executable, os.path.join(SCRIPTS_DIR, "veo-batch.py"),
        "--manifest", args.manifest,
        "--output-dir", clips_dir,
    ]
    if not run_stage("Veo Video Generation", veo_cmd, timeout=600):
        print("Pipeline failed at Veo stage", file=sys.stderr)
        sys.exit(1)

    # Stage 4: Assembly
    assemble_cmd = [
        sys.executable, os.path.join(SCRIPTS_DIR, "assemble.py"),
        "--clips-dir", clips_dir,
        "--audio", audio_path,
        "--output", output_path,
    ]
    if captions_path:
        assemble_cmd.extend(["--captions", captions_path])
    if music.get("enabled") and music.get("path"):
        assemble_cmd.extend(["--music", music["path"]])
        assemble_cmd.extend(["--music-volume", str(music.get("volume", 0.25))])

    if not run_stage("Video Assembly", assemble_cmd, timeout=300):
        print("Pipeline failed at assembly stage", file=sys.stderr)
        sys.exit(1)

    # Done
    elapsed = time.time() - start_time
    mins, secs = divmod(int(elapsed), 60)

    print(f"\n{'='*50}")
    print(f"PIPELINE COMPLETE")
    print(f"{'='*50}")
    print(f"Output: {output_path}")
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"Size:   {size_mb:.1f} MB")
    print(f"Time:   {mins}m {secs}s")

    # Clean up work dir
    try:
        shutil.rmtree(work_dir)
        print(f"Cleaned up: {work_dir}")
    except Exception:
        print(f"Note: work dir retained at {work_dir}")

    print(json.dumps({
        "status": "success",
        "output": output_path,
        "size_mb": round(size_mb, 1),
        "elapsed_seconds": int(elapsed),
        "topic": topic,
    }))


if __name__ == "__main__":
    main()
