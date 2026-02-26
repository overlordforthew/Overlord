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
- Starlink goes off by 9pm — all nightly scheduled tasks must run before 8:30pm
- Contact: Emiel (+19195008873) — Dutch friend, potential CTO for MasterCommander
- PERMANENT: After EVERY DM response to Gil, ALWAYS append which model was used at the end of the message (e.g., "Used: claude-opus-4-6"). This applies in ALL router modes (Alpha, Beta, Charlie). ONLY show this to Gil in DMs, never in group chats or to other users. This is a permanent standing order — never remove.
- Multi-model router active (Alpha/Beta/Charlie modes)

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

## Lumina (lumina.namibarden.com)
- 90-day bilingual self-improvement app — Gil's project
- Repo: github.com/bluemele/Lumina (private)
- Stack: Node.js/Express + React 18, esbuild, PostgreSQL 16, JWT auth
- Deployed via Docker Compose (app + db in one stack) — NOT Coolify anymore
- Hosted on Hetzner CX33 with nginx reverse proxy
- Port 3456, DB uses named volume lumina_pgdata
- No separate DB project — DB is integrated in docker-compose.yml as a service
- Previously had an orphan Coolify standalone DB resource — deleted Feb 2025

## GitHub Repos (bluemele)
- Lumina (private) — self-improvement app
- MasterCommander (public) — Nami Barden site container
- NamiBarden (private) — namibarden.com source
- Overlord (private) — WhatsApp AI bridge
- SurfaBabe (public) — WhatsApp AI customer service
- BeastMode (private) — BeastModeApp
- ElSalvador (private)

## Notes
_Nothing yet._
