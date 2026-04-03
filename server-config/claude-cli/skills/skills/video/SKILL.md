---
name: video
description: Create short-form videos (YouTube Shorts). Topic → script → Veo clips → voiceover → captions → final MP4. Use when user asks to create, make, or produce a video/short.
argument-hint: <topic or description>
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
metadata: {"clawdbot":{"emoji":"🎬"}}
---

# /video — Short-Form Video Pipeline

Create a YouTube Short from a topic: script writing → TTS voiceover → Veo video clips → word-level captions → assembled MP4.

## Interactive Flow

### 1. Get the topic
If `$ARGUMENTS` is provided, use it as the topic. Otherwise ask: "What's the video about?"

### 2. Ask preferences (one prompt, all at once)
Ask the user these choices in a single message:
- **Voice engine**: Kokoro (default, 67 voices) or Edge-TTS (Microsoft voices)?
- **Voice**: Suggest `af_bella` (Kokoro) or `en-US-AriaNeural` (Edge). User can pick another.
- **Veo model**: `veo-3.0` (best quality, slower) or `veo-3.0-fast` (faster, good quality)?
- **Background music**: Yes or no? (If yes, user can provide a file path or skip for no music)

### 3. Write the script
Write a narration script for a 45-60 second YouTube Short. Guidelines:
- Hook in the first 3 seconds — grab attention immediately
- 3-5 segments, each 8-15 seconds of narration
- Conversational, punchy tone — not robotic or lecture-y
- End with a memorable closer or call-to-action

### 4. Generate segment prompts
For each segment, write a **Veo video prompt** that:
- Describes the visual in cinematic detail
- Specifies vertical/portrait orientation
- Matches the narration content
- Uses consistent visual style across segments
- Avoids text, watermarks, or UI elements

### 5. Build the manifest
Write a JSON manifest file to `/tmp/video-<timestamp>.json`:

```json
{
  "topic": "the topic",
  "script": "full narration text",
  "segments": [
    {
      "text": "narration for this segment",
      "video_prompt": "cinematic Veo prompt for this segment",
      "duration": 8
    }
  ],
  "voice": {
    "engine": "kokoro",
    "voice_id": "af_bella",
    "speed": 1.0
  },
  "veo": {
    "model": "veo-3.0-generate-001",
    "aspect_ratio": "9:16"
  },
  "music": {
    "enabled": false,
    "path": null,
    "volume": 0.25
  },
  "output": {
    "dir": "/root/videos/shorts/",
    "filename": null
  }
}
```

**Duration rules:**
- Each segment duration should be 4-8 seconds (Veo limit)
- If narration is longer than 8 seconds, split into sub-segments
- Total video should be 45-60 seconds (8-10 segments max)

### 6. Run the pipeline
```bash
source /root/overlord/.env && python3 /root/.claude/skills/video/scripts/pipeline.py --manifest /tmp/video-<timestamp>.json
```

Use a **timeout of 600000ms** (10 minutes) — Veo clips take 1-5 minutes each.

The pipeline will print progress for each stage. Relay key status updates to the user:
- "Generating voiceover..."
- "Creating captions..."
- "Generating video clip 1/5..." (each clip takes 1-5 min)
- "Assembling final video..."

### 7. Report results
After pipeline completes, tell the user:
- Output file path and size
- Offer: "Want me to upload this to YouTube? (`yt upload <path>`)"

### 8. Handle errors
- **Veo quota exhausted**: Tell user to try tomorrow or use fewer segments
- **TTS failure**: Suggest switching engine (Kokoro ↔ Edge-TTS)
- **Partial clip failure**: Pipeline will note which clips failed — offer to retry with fewer segments
