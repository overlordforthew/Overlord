# Memory for 109457291874478

Created: 2026-02-21T16:21:47.501Z

## Key Facts
- Owns a Catana 581 sailing catamaran (58ft, Christophe Barreau design)
- Home port: Chaguaramas, Trinidad
- Twin Yanmar 110hp engines, 1700Ah 24V Happy Valley Lithium batteries, Victron Cerbo GX, B&G Zeus
- Building "Commander" — AI boat monitor that connects marine electronics (SignalK) to WhatsApp
- Runs on Mac Mini M4 aboard the vessel, local-first with Qwen 14B via Ollama
- Project uses Node.js, Baileys (WhatsApp), WebSocket for SignalK

## Preferences
- Wants Overlord to auto-detect and fix errors from log alerts without being asked — proactive error resolution
- Log alerts: pre-analyze before sending. Suppress one-off errors if service is currently working. Only send alerts for real, ongoing problems.

## NamiBarden.com (namibarden.com)
- Nami Barden's personal/spiritual coaching website — Gil manages it
- Static site: nginx + Docker, auto-deploys on push to main (github.com/bluemele/NamiBarden)
- Bilingual (Japanese/English) with localStorage-based language toggle
- YouTube channel: UCKkvy8wapsStrRPyaOrXeCQ (Nami Barden Channel)
- YouTube section uses dynamic RSS feed via nginx proxy at /api/youtube-feed
  - Fetches https://www.youtube.com/feeds/videos.xml?channel_id=UCKkvy8wapsStrRPyaOrXeCQ
  - Parses XML client-side, renders latest 3 videos with thumbnails
  - Falls back to hardcoded videos if fetch fails
  - No API key needed — uses public YouTube RSS feed
- CSP: connect-src 'self' (works because RSS is proxied through same domain)

## Notes
_Nothing yet._
