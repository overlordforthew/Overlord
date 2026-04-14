#!/bin/bash
# image-gen — Generate images via Pollinations.ai (free, no API key)
# Usage: image-gen.sh <command> [args...]
set -euo pipefail

# ── DEFAULTS ─────────────────────────────────────────────────────────────────

DEFAULT_WIDTH=1024
DEFAULT_HEIGHT=1024
DEFAULT_OUTPUT_DIR="/tmp"
DEFAULT_MODEL="flux"
MAX_RETRIES=2
RETRY_DELAY=5

# ── HELPERS ──────────────────────────────────────────────────────────────────

url_encode() {
  python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"
}

timestamp() {
  date +%Y%m%d_%H%M%S
}

apply_style() {
  local prompt="$1"
  local style="$2"
  case "$style" in
    photorealistic) echo "${prompt}, photorealistic, 8k, detailed" ;;
    anime)          echo "${prompt}, anime style, vibrant colors, Studio Ghibli" ;;
    oil-painting)   echo "${prompt}, oil painting, textured, classical" ;;
    watercolor)     echo "${prompt}, watercolor painting, soft, flowing" ;;
    sketch)         echo "${prompt}, pencil sketch, detailed linework" ;;
    3d-render)      echo "${prompt}, 3D render, Blender, octane render" ;;
    pixel-art)      echo "${prompt}, pixel art, retro, 16-bit" ;;
    ""|none)        echo "$prompt" ;;
    *)
      echo "ERROR: Unknown style '$style'. Run: image-gen.sh styles" >&2
      return 1
      ;;
  esac
}

download_image() {
  local prompt="$1"
  local output="$2"
  local width="$3"
  local height="$4"
  local seed="${5:-$RANDOM}"
  local model="${6:-$DEFAULT_MODEL}"

  local encoded
  encoded=$(url_encode "$prompt")
  local url="https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&model=${model}&nologo=true"

  echo "Generating: ${prompt}"
  echo "Size: ${width}x${height} | Model: ${model}"
  echo "Downloading..."

  local attempt=0
  local http_code
  while [ $attempt -le $MAX_RETRIES ]; do
    if [ $attempt -gt 0 ]; then
      echo "Retry ${attempt}/${MAX_RETRIES} (waiting ${RETRY_DELAY}s)..."
      sleep "$RETRY_DELAY"
    fi

    http_code=$(curl -sS -L --max-time 120 -o "$output" -w "%{http_code}" "$url")

    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
      # Verify it's actually an image (not a JSON error with 200 status)
      local content_type
      content_type=$(file -b --mime-type "$output" 2>/dev/null || echo "unknown")
      if [[ "$content_type" == image/* ]]; then
        local size
        size=$(du -h "$output" | cut -f1)
        echo "Saved: ${output} (${size})"
        return 0
      fi
    fi

    attempt=$((attempt + 1))
  done

  echo "ERROR: HTTP $http_code — generation failed after $((MAX_RETRIES + 1)) attempts" >&2
  rm -f "$output"
  return 1
}

# ── COMMANDS ─────────────────────────────────────────────────────────────────

cmd_generate() {
  local prompt=""
  local output=""
  local width="$DEFAULT_WIDTH"
  local height="$DEFAULT_HEIGHT"
  local style=""
  local model="$DEFAULT_MODEL"

  # Parse args
  while [ $# -gt 0 ]; do
    case "$1" in
      --output)  output="$2"; shift 2 ;;
      --width)   width="$2"; shift 2 ;;
      --height)  height="$2"; shift 2 ;;
      --style)   style="$2"; shift 2 ;;
      --model)   model="$2"; shift 2 ;;
      --*)
        echo "ERROR: Unknown option: $1" >&2
        return 1
        ;;
      *)
        if [ -z "$prompt" ]; then
          prompt="$1"
        else
          prompt="$prompt $1"
        fi
        shift
        ;;
    esac
  done

  if [ -z "$prompt" ]; then
    echo "ERROR: No prompt provided" >&2
    echo "Usage: image-gen.sh generate <prompt> [--output FILE] [--width W] [--height H] [--style STYLE] [--model MODEL]" >&2
    return 1
  fi

  # Apply style modifier
  if [ -n "$style" ]; then
    prompt=$(apply_style "$prompt" "$style")
  fi

  # Default output filename
  if [ -z "$output" ]; then
    output="${DEFAULT_OUTPUT_DIR}/generated_$(timestamp).png"
  fi

  download_image "$prompt" "$output" "$width" "$height" "$RANDOM" "$model"
}

cmd_styles() {
  cat <<'EOF'
Available style presets:

  photorealistic  — photorealistic, 8k, detailed
  anime           — anime style, vibrant colors, Studio Ghibli
  oil-painting    — oil painting, textured, classical
  watercolor      — watercolor painting, soft, flowing
  sketch          — pencil sketch, detailed linework
  3d-render       — 3D render, Blender, octane render
  pixel-art       — pixel art, retro, 16-bit

Usage: image-gen.sh generate "a mountain lake" --style watercolor
EOF
}

cmd_enhance() {
  local prompt="$*"

  if [ -z "$prompt" ]; then
    echo "ERROR: No prompt provided" >&2
    echo "Usage: image-gen.sh enhance <prompt>" >&2
    return 1
  fi

  echo "Original: ${prompt}"
  echo "Enhancing with LLM..."

  local enhanced
  enhanced=$(llm -m openrouter/openrouter/free "Enhance this into a detailed image generation prompt (50 words max): ${prompt}" 2>/dev/null)

  if [ -z "$enhanced" ]; then
    echo "ERROR: LLM enhancement failed. Generating with original prompt." >&2
    enhanced="$prompt"
  fi

  echo "Enhanced: ${enhanced}"
  echo ""

  local output="${DEFAULT_OUTPUT_DIR}/generated_$(timestamp).png"
  download_image "$enhanced" "$output" "$DEFAULT_WIDTH" "$DEFAULT_HEIGHT"
}

cmd_batch() {
  local prompts_file=""
  local output_dir="${DEFAULT_OUTPUT_DIR}"
  local style=""

  # Parse args
  while [ $# -gt 0 ]; do
    case "$1" in
      --output-dir) output_dir="$2"; shift 2 ;;
      --style)      style="$2"; shift 2 ;;
      --*)
        echo "ERROR: Unknown option: $1" >&2
        return 1
        ;;
      *)
        if [ -z "$prompts_file" ]; then
          prompts_file="$1"
        fi
        shift
        ;;
    esac
  done

  if [ -z "$prompts_file" ] || [ ! -f "$prompts_file" ]; then
    echo "ERROR: Prompts file not found: ${prompts_file:-<none>}" >&2
    echo "Usage: image-gen.sh batch <prompts_file> [--output-dir DIR] [--style STYLE]" >&2
    return 1
  fi

  mkdir -p "$output_dir"

  local count=0
  local total
  total=$(grep -c . "$prompts_file" || echo 0)
  echo "Generating ${total} images..."
  echo ""

  while IFS= read -r line || [ -n "$line" ]; do
    # Skip empty lines and comments
    [ -z "$line" ] && continue
    [[ "$line" == \#* ]] && continue

    count=$((count + 1))
    local prompt="$line"

    if [ -n "$style" ]; then
      prompt=$(apply_style "$prompt" "$style")
    fi

    local output="${output_dir}/batch_$(printf '%03d' $count)_$(timestamp).png"
    echo "[$count/$total] $line"
    download_image "$prompt" "$output" "$DEFAULT_WIDTH" "$DEFAULT_HEIGHT"
    echo ""
  done < "$prompts_file"

  echo "Batch complete: ${count} images generated in ${output_dir}"
}

cmd_social() {
  local platform="${1:-}"
  shift 2>/dev/null || true
  local prompt="$*"

  if [ -z "$platform" ] || [ -z "$prompt" ]; then
    echo "ERROR: Missing platform or prompt" >&2
    echo "Usage: image-gen.sh social <platform> <prompt>" >&2
    echo "Platforms: instagram, twitter, facebook, story" >&2
    return 1
  fi

  local width height
  case "$platform" in
    instagram|ig)  width=1080; height=1080 ;;
    twitter|x)     width=1200; height=675 ;;
    facebook|fb)   width=1200; height=630 ;;
    story|stories) width=1080; height=1920 ;;
    *)
      echo "ERROR: Unknown platform '$platform'" >&2
      echo "Supported: instagram, twitter, facebook, story" >&2
      return 1
      ;;
  esac

  local output="${DEFAULT_OUTPUT_DIR}/${platform}_$(timestamp).png"
  echo "Platform: ${platform} (${width}x${height})"
  download_image "$prompt" "$output" "$width" "$height"
}

# ── USAGE ────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
image-gen — Generate images via Pollinations.ai (free, no API key)

COMMANDS:
  generate <prompt> [options]         Generate an image from a text prompt
    --output FILE                     Output file (default: /tmp/generated_TIMESTAMP.png)
    --width W                         Width in pixels (default: 1024)
    --height H                        Height in pixels (default: 1024)
    --style STYLE                     Apply a style preset
    --model MODEL                     Pollinations model (default: flux)

  styles                              List available style presets

  enhance <prompt>                    Enhance prompt with LLM, then generate

  batch <prompts_file> [options]      Generate images from file (one prompt per line)
    --output-dir DIR                  Output directory (default: /tmp)
    --style STYLE                     Apply style to all images

  social <platform> <prompt>          Generate with platform-optimal dimensions
    Platforms: instagram (1080x1080), twitter (1200x675),
              facebook (1200x630), story (1080x1920)

EXAMPLES:
  image-gen.sh generate "a sunset over the ocean" --style watercolor
  image-gen.sh generate "cyberpunk city" --width 1920 --height 1080 --output /tmp/city.png
  image-gen.sh enhance "a boat in the ocean"
  image-gen.sh batch prompts.txt --output-dir /tmp/batch --style anime
  image-gen.sh social instagram "golden hour beach vibes"
  image-gen.sh social twitter "breaking news graphic"
  image-gen.sh styles
USAGE
}

# ── MAIN ─────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  generate|gen)    cmd_generate "$@" ;;
  styles)          cmd_styles ;;
  enhance)         cmd_enhance "$@" ;;
  batch)           cmd_batch "$@" ;;
  social)          cmd_social "$@" ;;
  help|--help|-h)  usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: image-gen.sh help"
    exit 1
    ;;
esac
