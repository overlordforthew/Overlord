---
name: image-generator
version: 1.0.0
description: "Generate images from text prompts via Pollinations.ai. Free, no API key. Supports style presets, prompt enhancement, batch generation, and social media dimensions."
---

# Image Generator

Generate images from text prompts using Pollinations.ai (free, no API key required).

## Quick Reference

| Command | What it does |
|---------|-------------|
| `image-gen.sh generate <prompt> [--style STYLE] [--output FILE] [--width W] [--height H]` | Generate image from prompt |
| `image-gen.sh styles` | List available style presets |
| `image-gen.sh enhance <prompt>` | Enhance prompt with LLM, then generate |
| `image-gen.sh batch <file> [--output-dir DIR] [--style STYLE]` | Batch generate from prompts file |
| `image-gen.sh social <platform> <prompt>` | Generate with platform-optimal dimensions |

## Usage

Scripts are at:
- Host: `/root/overlord/skills/image-generator/scripts/image-gen.sh`
- Container: `/app/skills/image-generator/scripts/image-gen.sh`

### Generate an image

```bash
image-gen.sh generate "a sunset over the ocean"
image-gen.sh generate "cyberpunk city at night" --style photorealistic --output /tmp/city.png
image-gen.sh generate "fantasy castle" --width 1920 --height 1080 --style oil-painting
```

### Style presets

```bash
image-gen.sh styles
```

Available: `photorealistic`, `anime`, `oil-painting`, `watercolor`, `sketch`, `3d-render`, `pixel-art`

### Enhance a prompt

Uses the `llm` CLI to expand a basic prompt into a detailed image generation prompt, then generates the image.

```bash
image-gen.sh enhance "a boat in the ocean"
# Output: Enhanced prompt + generated image
```

### Batch generate

Create a file with one prompt per line, then generate all:

```bash
image-gen.sh batch prompts.txt --output-dir /tmp/batch --style anime
```

Lines starting with `#` are skipped. Empty lines are skipped.

### Social media dimensions

```bash
image-gen.sh social instagram "golden hour beach vibes"   # 1080x1080
image-gen.sh social twitter "breaking news graphic"       # 1200x675
image-gen.sh social facebook "event cover photo"          # 1200x630
image-gen.sh social story "vertical promo"                # 1080x1920
```

## How It Works

1. Constructs a URL: `https://image.pollinations.ai/prompt/{URL_ENCODED_PROMPT}?width={W}&height={H}&seed={RANDOM}&nologo=true`
2. Downloads the generated image via curl
3. Style presets append modifier text to the prompt (e.g., "photorealistic, 8k, detailed")
4. The `enhance` command pipes the prompt through `llm` CLI for AI-powered expansion before generating

## Dependencies

- `curl` — image download
- `python3` — URL encoding
- `llm` CLI — prompt enhancement (only needed for `enhance` command)

## API

- **Pollinations.ai** — Free, no API key, no rate limit published. Returns PNG images.
- **Together.ai** — Future option if API key is added.
