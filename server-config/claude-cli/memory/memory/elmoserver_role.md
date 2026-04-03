---
name: ElmoServer as ML Inference Layer
description: ElmoServer (100.89.16.27) is the dedicated ML/inference server — deploy new AI services here first
type: reference
---

ElmoServer has become the dedicated ML inference layer for Gil's stack. All AI/ML services that need sustained compute run here, not on the CX33 Hetzner.

**Why:** CX33 has 8GB RAM / 4 cores, no GPU — too constrained for ML models alongside ~20 app containers. ElmoServer has 27GB RAM, GTX 1070 Ti (8GB VRAM), and runs fewer services.

**How to apply:** When Gil asks to deploy a new ML/AI model (LLM, TTS, forecasting, image gen, etc.), default to containerizing it on ElmoServer with a Tailscale-bound API endpoint. Hetzner apps consume it over Tailscale.

## Current ML Services (as of 2026-04-02)
| Service | Port | Mode | Purpose |
|---------|------|------|---------|
| Kokoro TTS | 8880 | CPU/ONNX | Text-to-speech (67 voices, OpenAI-compatible) |
| F5 TTS | 7860 | GPU | Text-to-speech (voice cloning) |
| XTTS API | 8020 | GPU | Text-to-speech (multilingual) |
| TimesFM 2.5 | 8100 | CPU | Zero-shot time series forecasting |

## Access Pattern
- All services bind to Tailscale IP `100.89.16.27` (not 0.0.0.0, not 127.0.0.1)
- Hetzner apps call via Tailscale: `http://100.89.16.27:<port>`
- No public exposure — Tailscale-only
