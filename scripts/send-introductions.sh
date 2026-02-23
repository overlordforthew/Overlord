#!/bin/bash
# Send introduction messages to Nami and Seneca
# Run once after deploying multi-user agent system

TOKEN="${WEBHOOK_TOKEN:-$(grep WEBHOOK_TOKEN /root/overlord/.env 2>/dev/null | cut -d= -f2)}"
BASE="http://localhost:3001/api/send"

echo "Sending introduction to Nami (Ai Chan)..."
curl -s -X POST "$BASE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "84393251371@s.whatsapp.net",
    "text": "Konnichiwa, Nami! I'\''m Ai Chan, your personal AI assistant 🌸\n\nI can help you with the NamiBarden website, create content, research things, make QR codes, voice notes, and more.\n\nTry /help to see what I can do!\n\nYoroshiku ne~ ✨"
  }'

echo ""
echo "Sending introduction to Seneca (Dex)..."
curl -s -X POST "$BASE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "18587794462@s.whatsapp.net",
    "text": "Yo Seneca! I'\''m Dex, your AI right here on WhatsApp 🎯\n\nI'\''m locked in on your YouTube channel @senecatheyoungest — content ideas, analytics breakdowns, thumbnail concepts, whatever you need.\n\nHit /help to see what I can do. Let'\''s build something 🔥"
  }'

echo ""
echo "Done!"
