---
name: createvideo
description: Create YouTube Shorts using the youtube-shorts-pipeline on ElmoServer. Full pipeline from topic to uploaded video — AI script, b-roll, voiceover, captions, music, thumbnail, upload. Use when user asks to create a YouTube Short or video.
argument-hint: <topic or news headline>
allowed-tools: Bash, Read, Write, Edit, Grep, Glob
metadata: {"clawdbot":{"emoji":"🎬"}}
---

# /createvideo — YouTube Shorts Pipeline (ElmoServer)

Create a YouTube Short from a topic using the youtube-shorts-pipeline on ElmoServer (GPU box).

Pipeline: topic → research → Claude script → Gemini Imagen b-roll → voiceover → Whisper captions → music → ffmpeg assembly → YouTube upload.

## Prerequisites

- ElmoServer reachable: `ssh root@100.89.16.27`
- Pipeline installed at `/root/projects/youtube-shorts-pipeline/` on ElmoServer
- Config at `~/.youtube-shorts-pipeline/config.json` on ElmoServer (created by setup wizard on first run)
- Required API keys: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`
- Optional: `ELEVENLABS_API_KEY` (premium TTS), YouTube OAuth token (for upload)

## Interactive Flow

### 1. Get the topic
If `$ARGUMENTS` is provided, use it as the topic. Otherwise ask: "What's the video about?"

The user can also say "trending" or "discover" to use the topic engine.

### 2. Ask preferences (one prompt)
- **Language**: English (default) or Hindi?
- **TTS**: Edge TTS (free, default) or ElevenLabs (premium)?
- **Full pipeline or draft only?** (draft = script + metadata, no video generation)

### 3. Run the pipeline on ElmoServer

**Discover trending topics:**
```bash
ssh root@100.89.16.27 "cd /root/projects/youtube-shorts-pipeline && .venv/bin/python -m pipeline topics --limit 15" 2>&1
```

**Draft only (fast, no video):**
```bash
ssh root@100.89.16.27 "cd /root/projects/youtube-shorts-pipeline && .venv/bin/python -m pipeline draft --news '<TOPIC>'" 2>&1
```

**Full pipeline (draft + produce + upload):**
```bash
ssh root@100.89.16.27 "cd /root/projects/youtube-shorts-pipeline && .venv/bin/python -m pipeline run --news '<TOPIC>' --lang en" 2>&1
```
Use a **timeout of 600000ms** (10 minutes) — video generation takes several minutes.

**Dry run (draft only, skip produce/upload):**
```bash
ssh root@100.89.16.27 "cd /root/projects/youtube-shorts-pipeline && .venv/bin/python -m pipeline run --news '<TOPIC>' --dry-run" 2>&1
```

**Produce from existing draft:**
```bash
ssh root@100.89.16.27 "cd /root/projects/youtube-shorts-pipeline && .venv/bin/python -m pipeline produce --draft <DRAFT_PATH> --lang en" 2>&1
```

**Upload existing video:**
```bash
ssh root@100.89.16.27 "cd /root/projects/youtube-shorts-pipeline && .venv/bin/python -m pipeline upload --draft <DRAFT_PATH> --lang en" 2>&1
```

### 4. Report results
After pipeline completes, tell the user:
- Script summary and title
- Output video file path (on ElmoServer)
- YouTube URL (if uploaded)
- Cost estimate (~$0.11 per video: Claude ~$0.02, Gemini ~$0.04, ElevenLabs ~$0.05)

To copy the video to Hetzner for review:
```bash
scp root@100.89.16.27:<video_path> /root/videos/
```

### 5. Handle errors
- **First run / no config**: The setup wizard runs interactively — tell user to SSH in and run it manually: `ssh root@100.89.16.27` then `cd /root/projects/youtube-shorts-pipeline && .venv/bin/python -m pipeline run --news "test" --dry-run`
- **API key missing**: Tell user to add it to `~/.youtube-shorts-pipeline/config.json` on ElmoServer
- **YouTube quota**: Daily upload limit hit — wait 24h
- **ffmpeg not found**: `ssh root@100.89.16.27 "apt install -y ffmpeg"`
- **Whisper OOM**: ElmoServer has 27GB RAM + 8GB VRAM — should be fine, but if OOM, try `--lang en` (smaller model)

## Pipeline Stages Detail

| Stage | What | API |
|-------|------|-----|
| Research | DuckDuckGo search for facts | Free |
| Draft | Claude writes script + metadata | Anthropic |
| B-roll | 3 AI images with Ken Burns effect | Gemini Imagen |
| Voiceover | TTS narration | Edge (free) / ElevenLabs |
| Captions | Word-level timestamps + ASS burn-in | Whisper (local) |
| Music | Royalty-free track + auto-ducking | Local |
| Assembly | ffmpeg composite | Local |
| Thumbnail | AI image + text overlay | Gemini + Pillow |
| Upload | YouTube API + SRT + thumbnail | YouTube OAuth |

## File Locations (on ElmoServer)

- Config: `~/.youtube-shorts-pipeline/config.json`
- Drafts: `~/.youtube-shorts-pipeline/drafts/<timestamp>.json`
- Videos: `~/.youtube-shorts-pipeline/media/pipeline_<id>_<lang>.mp4`
- Logs: `~/.youtube-shorts-pipeline/logs/pipeline_YYYYMMDD.log`
