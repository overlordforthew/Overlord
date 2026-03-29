#!/usr/bin/env python3
"""Transcribe audio using faster-whisper. Outputs plain text to stdout."""
import sys

if len(sys.argv) < 2:
    print("Usage: faster-whisper-transcribe.py <audio_file> [model_size]", file=sys.stderr)
    sys.exit(1)

model_size = sys.argv[2] if len(sys.argv) > 2 else "base"

from faster_whisper import WhisperModel
model = WhisperModel(model_size, device="cpu", compute_type="int8")
segments, _ = model.transcribe(sys.argv[1], beam_size=5)
print(" ".join(s.text for s in segments).strip())
