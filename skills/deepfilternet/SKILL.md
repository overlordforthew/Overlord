# Skill: deepfilternet

## Description
Real-time noise reduction for audio files, runs entirely on CPU. Cleans background noise from voice notes before passing them to Whisper for transcription. Dramatically improves transcription accuracy on noisy recordings.

## Type
Library (Python package)

## Configuration
- Package: `deepfilternet`
- Install: `pip install deepfilternet`
- CPU-only: no GPU required
- Models download automatically on first run

## Usage
```bash
# CLI: clean a voice note (compensate-delay preserves timing alignment)
deepfilternet --compensate-delay audio.wav

# Output: audio_DeepFilterNet3.wav (in same directory)

# Specify output path
deepfilternet --compensate-delay -o cleaned.wav audio.wav

# Process multiple files
deepfilternet --compensate-delay *.wav
```

```python
# Python API
from df.enhance import enhance, init_df

model, df_state, _ = init_df()
enhanced_audio = enhance(model, df_state, noisy_audio)
```

```bash
# Typical pipeline: clean then transcribe
deepfilternet --compensate-delay voicenote.wav
whisper voicenote_DeepFilterNet3.wav --model medium
```

## When to Use
- Pre-processing voice notes before Whisper transcription
- Cleaning noisy WhatsApp voice messages
- Any audio with background noise (wind, traffic, crowd)
- Pipeline: record -> deepfilternet -> whisper -> text

## Requirements
- Python 3.8+
- `pip install deepfilternet`
- CPU-only (no GPU needed)
- ~500MB disk for models (auto-downloaded)
