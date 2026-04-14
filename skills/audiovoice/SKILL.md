---
name: audiovoice
description: High-quality text-to-speech using self-hosted Kokoro TTS on ElmoServer
homepage: https://github.com/remsky/Kokoro-FastAPI
metadata: {"clawdbot":{"emoji":"🎙️","requires":{"services":["kokoro-tts"]}}}
---

# Audiovoice — Kokoro TTS

Self-hosted text-to-speech using Kokoro v1.0 (82M params) running on ElmoServer (100.89.16.27:8880).
OpenAI-compatible API. 67 voices across 9 languages. Zero subscription cost.

## WhatsApp Commands

- `/audiovoice <text>` — Generate high-quality speech from text
- `/voice <text>` — Alias for /audiovoice
- `/audiovoice --voice am_adam <text>` — Use a specific voice
- `/audiovoice voices` — List all available voices
- Send a `.txt` file with caption `/audiovoice` — Narrate a script/document

## Voice Naming Convention

- `af_*` — American Female (af_bella, af_sarah, af_sky, af_nicole, af_heart, af_nova...)
- `am_*` — American Male (am_adam, am_michael, am_echo, am_liam, am_puck...)
- `bf_*` — British Female (bf_emma, bf_isabella...)
- `bm_*` — British Male (bm_george, bm_lewis...)
- Also: Japanese (`jf_/jm_`), Chinese (`zf_/zm_`), Spanish (`ef_/em_`), French (`ff_`), Hindi (`hf_/hm_`), Italian (`if_/im_`), Portuguese (`pf_/pm_`)

## API Direct Access

```bash
# Generate speech
curl -X POST http://100.89.16.27:8880/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"kokoro","voice":"af_bella","input":"Hello world"}' \
  --output speech.mp3

# List voices
curl http://100.89.16.27:8880/v1/audio/voices

# Web UI
http://100.89.16.27:8880/web
```

## Infrastructure

- **Server:** ElmoServer (Tailscale: 100.89.16.27)
- **Container:** kokoro-fastapi-cpu-kokoro-tts-1
- **Port:** 8880
- **Model:** Kokoro v1.0 (82M params, ONNX CPU inference)
- **Docker Compose:** `/root/projects/Kokoro-FastAPI/docker/cpu/docker-compose.yml`
- **Env var:** `KOKORO_API_URL` (defaults to http://100.89.16.27:8880)
- **Default voice:** `KOKORO_DEFAULT_VOICE` (defaults to af_bella)
