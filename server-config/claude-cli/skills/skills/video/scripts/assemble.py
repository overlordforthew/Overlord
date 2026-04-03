#!/usr/bin/env python3
"""FFmpeg video assembly: concat clips, burn captions, mix audio."""

import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile


def run_ffmpeg(args_list, desc=""):
    """Run an ffmpeg command and handle errors."""
    cmd = ["ffmpeg", "-y"] + args_list
    if desc:
        print(f"  {desc}...")
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
    if result.returncode != 0:
        print(f"  FFmpeg error: {result.stderr[-500:]}", file=sys.stderr)
        return False
    return True


def get_duration(filepath):
    """Get media duration in seconds using ffprobe."""
    result = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "csv=p=0", filepath],
        capture_output=True, text=True, timeout=30
    )
    try:
        return float(result.stdout.strip())
    except (ValueError, AttributeError):
        return 0.0


def concat_clips(clips_dir, output_path):
    """Concatenate video clips in order."""
    clips = sorted(glob.glob(os.path.join(clips_dir, "clip_*.mp4")))
    if not clips:
        print("Error: no clips found in directory", file=sys.stderr)
        return False

    print(f"Concatenating {len(clips)} clips...")

    # First, normalize all clips to same resolution and codec
    normalized = []
    for i, clip in enumerate(clips):
        norm_path = os.path.join(clips_dir, f"norm_{i:02d}.mp4")
        ok = run_ffmpeg([
            "-i", clip,
            "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-r", "30",
            "-an",  # Strip audio from clips (we'll add voiceover)
            "-pix_fmt", "yuv420p",
            norm_path,
        ], f"Normalizing clip {i+1}/{len(clips)}")
        if ok:
            normalized.append(norm_path)
        else:
            print(f"  Warning: skipping clip {i+1}", file=sys.stderr)

    if not normalized:
        return False

    # Write concat list
    list_path = os.path.join(clips_dir, "concat_list.txt")
    with open(list_path, "w") as f:
        for path in normalized:
            f.write(f"file '{path}'\n")

    ok = run_ffmpeg([
        "-f", "concat", "-safe", "0", "-i", list_path,
        "-c", "copy",
        output_path,
    ], "Concatenating normalized clips")

    return ok


def add_audio_and_captions(video_path, audio_path, captions_path, music_path, music_volume, output_path):
    """Add voiceover, burn captions, and optionally mix background music."""
    video_dur = get_duration(video_path)
    audio_dur = get_duration(audio_path)

    print(f"Video duration: {video_dur:.1f}s")
    print(f"Audio duration: {audio_dur:.1f}s")

    # Build filter complex
    inputs = ["-i", video_path, "-i", audio_path]
    filter_parts = []
    audio_map = "[1:a]"

    if music_path and os.path.exists(music_path):
        inputs.extend(["-i", music_path])
        # Voice ducking: lower music when voice is present
        filter_parts.append(
            f"[2:a]volume={music_volume}[music];"
            f"[music][1:a]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=1000[ducked];"
            f"[1:a][ducked]amix=inputs=2:duration=first[mixed]"
        )
        audio_map = "[mixed]"

    # Build ffmpeg command
    cmd = inputs[:]

    # Use the shorter of video/audio duration
    target_dur = min(video_dur, audio_dur) if audio_dur > 0 else video_dur

    vf_filter = ""
    if captions_path and os.path.exists(captions_path):
        vf_filter = f"ass={captions_path}"

    cmd_args = []
    if vf_filter and filter_parts:
        # Both captions and music
        full_filter = f"{';'.join(filter_parts)};[0:v]{vf_filter}[vout]"
        cmd_args = cmd + [
            "-filter_complex", full_filter,
            "-map", "[vout]", "-map", audio_map,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k",
            "-t", str(target_dur),
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_path,
        ]
    elif vf_filter:
        # Captions only, no music
        cmd_args = cmd + [
            "-vf", vf_filter,
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k",
            "-t", str(target_dur),
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_path,
        ]
    elif filter_parts:
        # Music only, no captions
        full_filter = ";".join(filter_parts)
        cmd_args = cmd + [
            "-filter_complex", full_filter,
            "-map", "0:v", "-map", audio_map,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-c:a", "aac", "-b:a", "192k",
            "-t", str(target_dur),
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            output_path,
        ]
    else:
        # Plain: just combine video + audio
        cmd_args = cmd + [
            "-map", "0:v", "-map", "1:a",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k",
            "-t", str(target_dur),
            "-movflags", "+faststart",
            output_path,
        ]

    return run_ffmpeg(cmd_args, "Assembling final video")


def main():
    parser = argparse.ArgumentParser(description="Assemble final video from clips + audio + captions")
    parser.add_argument("--clips-dir", required=True, help="Directory containing Veo clips")
    parser.add_argument("--audio", required=True, help="Voiceover audio file")
    parser.add_argument("--captions", default=None, help="ASS subtitle file")
    parser.add_argument("--music", default=None, help="Background music file")
    parser.add_argument("--music-volume", type=float, default=0.25, help="Music volume (default: 0.25)")
    parser.add_argument("--output", "-o", required=True, help="Output MP4 path")

    args = parser.parse_args()

    if not os.path.isdir(args.clips_dir):
        print(f"Error: clips directory not found: {args.clips_dir}", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(args.audio):
        print(f"Error: audio file not found: {args.audio}", file=sys.stderr)
        sys.exit(1)

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)

    # Step 1: Concat all clips into one video
    concat_path = os.path.join(args.clips_dir, "concat.mp4")
    if not concat_clips(args.clips_dir, concat_path):
        print("Error: clip concatenation failed", file=sys.stderr)
        sys.exit(1)

    # Step 2: Add audio, captions, and music
    if not add_audio_and_captions(
        concat_path, args.audio, args.captions,
        args.music, args.music_volume, args.output
    ):
        print("Error: final assembly failed", file=sys.stderr)
        sys.exit(1)

    size_mb = os.path.getsize(args.output) / (1024 * 1024)
    duration = get_duration(args.output)

    print(f"\nFinal video: {args.output}")
    print(f"Duration:    {duration:.1f}s")
    print(f"Size:        {size_mb:.1f} MB")
    print(json.dumps({
        "status": "success",
        "output": args.output,
        "duration": round(duration, 1),
        "size_mb": round(size_mb, 1),
    }))


if __name__ == "__main__":
    main()
