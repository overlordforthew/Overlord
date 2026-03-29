# Skill: faster-whisper

## Description
4x faster Whisper transcription using CTranslate2 with half the VRAM of standard Whisper. Drop-in replacement for openai-whisper with the same model quality. Runs on ElmoServer where GPU is available.

## Type
Service (ElmoServer)

## Configuration
- Location: ElmoServer (100.89.16.27)
- Python package: `faster-whisper`
- GPU: required for full speed advantage
- VRAM: ~2GB for medium model with int8 quantization

## Usage
```python
from faster_whisper import WhisperModel

# Load model with int8 quantization (halves VRAM vs float16)
model = WhisperModel("medium", device="cuda", compute_type="int8")

segments, info = model.transcribe("audio.wav", beam_size=5)

for segment in segments:
    print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
```

```bash
# Or via CLI
faster-whisper audio.wav --model medium --device cuda --compute_type int8
```

## When to Use
- Voice note transcription where speed matters
- Replacing standard Whisper when VRAM is constrained
- Batch transcription jobs on ElmoServer
- Any Whisper use case — faster-whisper is a strict drop-in improvement

## Requirements
- ElmoServer (GPU access)
- CUDA-capable GPU, ~2GB VRAM (medium + int8)
- Python 3.8+, `pip install faster-whisper`
- For CPU-only: works but loses the 4x speed advantage
