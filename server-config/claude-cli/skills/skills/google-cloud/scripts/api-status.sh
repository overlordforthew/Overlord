#!/usr/bin/env bash
# Google API Status Checker
# Tests connectivity to all known Google APIs

set +e  # Dont exit on individual API check failures

source /root/overlord/.env 2>/dev/null || true
GKEY="${GOOGLE_API_KEY:-}"

echo "========================================"
echo " Google API Status Report"
echo " $(date '+%Y-%m-%d %H:%M:%S')"
echo "========================================"
echo

# --- API Key APIs ---
echo "--- API Key APIs (project 961837060087) ---"
echo

if [ -z "$GKEY" ]; then
  echo "[SKIP] No GOOGLE_API_KEY found in /root/overlord/.env"
else
  # Gemini
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://generativelanguage.googleapis.com/v1beta/models?key=$GKEY" 2>/dev/null)
  if [ "$STATUS" = "200" ]; then
    MODEL_COUNT=$(curl -s "https://generativelanguage.googleapis.com/v1beta/models?key=$GKEY" 2>/dev/null | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null)
    echo "[OK]   Gemini API — $MODEL_COUNT models available"
  else
    echo "[FAIL] Gemini API — HTTP $STATUS"
  fi

  # Veo (check model exists)
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://generativelanguage.googleapis.com/v1beta/models/veo-3.0-generate-001?key=$GKEY" 2>/dev/null)
  [ "$STATUS" = "200" ] && echo "[OK]   Veo API — veo-3.0 available" || echo "[FAIL] Veo API — HTTP $STATUS"

  # Imagen
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001?key=$GKEY" 2>/dev/null)
  [ "$STATUS" = "200" ] && echo "[OK]   Imagen API — imagen-4.0 available" || echo "[FAIL] Imagen API — HTTP $STATUS"

  # YouTube
  YTKEY="${YOUTUBE_API_KEY:-$GKEY}"
  RESP=$(curl -s "https://www.googleapis.com/youtube/v3/search?part=snippet&q=test&maxResults=1&key=$YTKEY" 2>/dev/null)
  if echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if 'items' in d else 1)" 2>/dev/null; then
    echo "[OK]   YouTube Data API v3"
  else
    MSG=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('error',{}).get('message','unknown')[:60])" 2>/dev/null)
    echo "[FAIL] YouTube Data API v3 — $MSG"
  fi

  # Maps
  RESP=$(curl -s "https://maps.googleapis.com/maps/api/geocode/json?address=Miami&key=$GKEY" 2>/dev/null)
  MSTATUS=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','unknown'))" 2>/dev/null)
  [ "$MSTATUS" = "OK" ] && echo "[OK]   Maps/Geocoding API" || echo "[FAIL] Maps/Geocoding API — $MSTATUS"

  # Vision
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST -H "Content-Type: application/json" -d '{"requests":[]}' \
    "https://vision.googleapis.com/v1/images:annotate?key=$GKEY" 2>/dev/null)
  [ "$STATUS" = "200" ] && echo "[OK]   Cloud Vision API" || echo "[FAIL] Cloud Vision API — HTTP $STATUS"

  # Translation
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://translation.googleapis.com/language/translate/v2/languages?key=$GKEY" 2>/dev/null)
  [ "$STATUS" = "200" ] && echo "[OK]   Cloud Translation API" || echo "[FAIL] Cloud Translation API — HTTP $STATUS"

  # TTS
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://texttospeech.googleapis.com/v1/voices?key=$GKEY" 2>/dev/null)
  [ "$STATUS" = "200" ] && echo "[OK]   Cloud Text-to-Speech API" || echo "[FAIL] Cloud Text-to-Speech API — HTTP $STATUS"

  # Custom Search
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    "https://customsearch.googleapis.com/customsearch/v1?q=test&key=$GKEY" 2>/dev/null)
  [ "$STATUS" = "200" ] && echo "[OK]   Custom Search API" || echo "[FAIL] Custom Search API — HTTP $STATUS"
fi

echo
echo "--- OAuth/Workspace APIs (gws CLI) ---"
echo

if ! command -v gws &>/dev/null; then
  echo "[SKIP] gws CLI not installed"
else
  # Test with a simple Drive call
  RESP=$(gws drive about get --params '{"fields": "user"}' 2>&1)
  if echo "$RESP" | grep -q '"user"'; then
    USER=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('user',{}).get('emailAddress','unknown'))" 2>/dev/null)
    echo "[OK]   Workspace OAuth — authenticated as $USER"
    echo "[OK]   Drive API"
  elif echo "$RESP" | grep -qi "invalid_grant\|401\|expired"; then
    echo "[FAIL] Workspace OAuth — token expired. Run: gws auth login"
  else
    echo "[FAIL] Workspace OAuth — $(echo "$RESP" | head -1)"
  fi

  # Only test other services if OAuth is working
  if echo "$RESP" | grep -q '"user"'; then
    # Gmail
    GRESP=$(gws gmail users getProfile --params '{"userId": "me"}' 2>&1)
    echo "$GRESP" | grep -q "emailAddress" && echo "[OK]   Gmail API" || echo "[FAIL] Gmail API"

    # Calendar
    CRESP=$(gws calendar calendarList list --params '{"maxResults": 1}' 2>&1)
    echo "$CRESP" | grep -q "items\|etag" && echo "[OK]   Calendar API" || echo "[FAIL] Calendar API"

    # Sheets
    echo "[INFO] Sheets API — available (requires spreadsheet ID to test)"
    echo "[INFO] Docs API — available (requires document ID to test)"
    echo "[INFO] Tasks API — available via gws tasks"
  fi
fi

echo
echo "========================================"
echo " Key files:"
echo "   API key: /root/overlord/.env (GOOGLE_API_KEY)"
echo "   OAuth:   ~/.config/gws/"
echo "   Console: https://console.cloud.google.com/apis/dashboard?project=overlord-488220"
echo "========================================"
