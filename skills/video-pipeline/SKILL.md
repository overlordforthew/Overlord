# Skill: Video Production Pipeline

## Scope
Nami's meditation YouTube channel video automation. End-to-end pipeline from research to final video.

## Pipeline Steps

### 1. Market Research
- Analyze trending meditation topics on YouTube
- Check competitor channels for content gaps
- Identify seasonal/timely themes (stress relief, sleep, morning routines)
- Tools: WebSearch, YouTube API

### 2. Script Generation
- Write meditation scripts in English
- Tone: calm, warm, guiding — Nami's voice
- Structure: intro (30s) → body (5-15min) → closing (30s)
- Include timing cues and pause markers
- Generate bilingual versions if needed

### 3. Voice Synthesis
- Service: ElevenLabs API
- Voice: Nami's cloned voice (or closest match)
- Settings: stability high, clarity high, speaking rate slow
- Output: MP3 audio file

### 4. Visual Content
- Background imagery: DALL-E for meditation scenes
- Style: serene landscapes, soft colors, nature themes
- Resolution: 1920x1080 (YouTube standard)
- Alternative: stock footage from Pexels/Pixabay

### 5. Video Assembly
- Combine audio + visuals
- Add subtle background music (royalty-free)
- Add captions/subtitles
- Render to MP4 (H.264, AAC audio)
- Tools: FFmpeg for assembly

### 6. Publishing
- Upload to YouTube via API
- Optimize: title, description, tags, thumbnail
- Schedule for peak hours
- Cross-post teasers to social media

## Veo Integration
- Google Veo skill available at /root/.claude/skills/veo/
- Can generate AI video clips for intros/transitions
- Models: veo-2.0, veo-3.0, veo-3.0-fast, veo-3.1-preview
- API key in /root/.env (GOOGLE_API_KEY)
- Output: /root/videos/ (update to /root/videos/)

## File Locations
- Scripts: /root/overlord/projects/nami-channel/scripts/
- Audio: /root/overlord/projects/nami-channel/audio/
- Video: /root/overlord/projects/nami-channel/video/
