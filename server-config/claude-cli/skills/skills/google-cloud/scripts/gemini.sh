#!/usr/bin/env bash
# gemini.sh — Quick Gemini API operations
#
# Usage:
#   gemini.sh ask "prompt"                     — Generate text (gemini-2.5-flash)
#   gemini.sh ask "prompt" --model <model>     — Generate with specific model
#   gemini.sh models                           — List available models
#   gemini.sh embed "text"                     — Get embedding
#   gemini.sh image "prompt"                   — Generate image (Imagen)
#   gemini.sh count "text"                     — Count tokens

source /root/overlord/.env 2>/dev/null
GKEY="${GOOGLE_API_KEY:-}"
[ -z "$GKEY" ] && echo "ERROR: No GOOGLE_API_KEY" && exit 1

BASE="https://generativelanguage.googleapis.com/v1beta"

case "${1:-help}" in
    ask)
        shift
        PROMPT=""
        MODEL="gemini-2.5-flash"
        while [ $# -gt 0 ]; do
            case "$1" in
                --model) MODEL="$2"; shift 2 ;;
                *) PROMPT="$1"; shift ;;
            esac
        done
        [ -z "$PROMPT" ] && echo "Usage: gemini.sh ask \"prompt\" [--model model]" && exit 1
        
        # Escape the prompt for JSON
        ESCAPED=$(python3 -c "import json; print(json.dumps($( python3 -c "import json; print(json.dumps('$PROMPT'))"))[1:-1])")
        
        curl -s "$BASE/models/$MODEL:generateContent?key=$GKEY" \
            -H "Content-Type: application/json" \
            -d "{\"contents\":[{\"parts\":[{\"text\":\"$ESCAPED\"}]}]}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'candidates' in d:
    text = d['candidates'][0].get('content',{}).get('parts',[{}])[0].get('text','')
    print(text)
elif 'error' in d:
    print(f'Error: {d[\"error\"].get(\"message\",\"unknown\")}')
"
        ;;
    
    models)
        curl -s "$BASE/models?key=$GKEY" | python3 -c "
import json, sys
d = json.load(sys.stdin)
for m in sorted(d.get('models',[]), key=lambda x: x['name']):
    name = m['name'].replace('models/','')
    methods = [x.split('/')[-1] for x in m.get('supportedGenerationMethods',[])]
    print(f'  {name}: {', '.join(methods)}')
"
        ;;
    
    embed)
        [ -z "$2" ] && echo "Usage: gemini.sh embed \"text\"" && exit 1
        ESCAPED=$(python3 -c "import json; print(json.dumps('$2'))")
        curl -s "$BASE/models/gemini-embedding-001:embedContent?key=$GKEY" \
            -H "Content-Type: application/json" \
            -d "{\"content\":{\"parts\":[{\"text\":$ESCAPED}]}}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'embedding' in d:
    vals = d['embedding']['values']
    print(f'Embedding: {len(vals)} dimensions')
    print(f'First 5: {vals[:5]}')
elif 'error' in d:
    print(f'Error: {d[\"error\"].get(\"message\",\"unknown\")}')
"
        ;;
    
    image)
        shift
        PROMPT="$1"
        OUTPUT="${2:-/root/pictures/imagen_$(date +%Y%m%d_%H%M%S).png}"
        [ -z "$PROMPT" ] && echo "Usage: gemini.sh image \"prompt\" [output_path]" && exit 1
        mkdir -p "$(dirname "$OUTPUT")"
        
        python3 -c "
import os, sys
from google import genai
from google.genai import types

client = genai.Client(api_key='$GKEY')
response = client.models.generate_images(
    model='imagen-4.0-generate-001',
    prompt='$PROMPT',
    config=types.GenerateImagesConfig(number_of_images=1)
)
if response.generated_images:
    response.generated_images[0].image.save('$OUTPUT')
    size = os.path.getsize('$OUTPUT')
    print(f'Saved: $OUTPUT ({size/1024:.0f} KB)')
else:
    print('No image generated')
"
        ;;
    
    count)
        [ -z "$2" ] && echo "Usage: gemini.sh count \"text\"" && exit 1
        ESCAPED=$(python3 -c "import json; print(json.dumps('$2'))")
        curl -s "$BASE/models/gemini-2.5-flash:countTokens?key=$GKEY" \
            -H "Content-Type: application/json" \
            -d "{\"contents\":[{\"parts\":[{\"text\":$ESCAPED}]}]}" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print(f'Tokens: {d.get(\"totalTokens\", \"error\")}')
"
        ;;
    
    help|*)
        cat << 'USAGE'
gemini.sh — Quick Gemini API operations

  ask "prompt" [--model name]     Generate text
  models                          List available models  
  embed "text"                    Get text embedding
  image "prompt" [output_path]    Generate image (Imagen 4.0)
  count "text"                    Count tokens
USAGE
        ;;
esac
