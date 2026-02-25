# Work Logs

## 2026-02-24 (Session 2)

### MasterCommander — Interactive WhatsApp Demo
- Replaced static 4-message demo with fully interactive chat
- NLP matching: 60+ natural language patterns map to 6 data commands
- 11 conversational AI responses (worry, goodnight, departure prep, fuel, water, depth, etc.)
- Auto-play "Watch Demo" scenario — 6-exchange captain conversation with typing delays
- Contextual follow-up pills change after each response
- Codex review: fixed P2 NLP shadowing ("report" keyword) + typing indicator on scenario stop

### MasterCommander — Renames & CTA Updates
- Renamed FleetMind → BigBlue across HTML, CSS, flow.js
- BigBlue tagline: "Your yacht is one data point in a world of sailors."
- CTA buttons: "Chat Online Now" + "WhatsApp" (was "Chat on WhatsApp" + "Private Yacht Inquiry")
- CTA heading: "Ready to sleep easy?" (was "Ready to monitor your fleet?")

### MasterCommander — Nav & Section Restructure
- Merged "System Architecture" + "How It Works" into single "The How" section
- Added "Download App" + "Login" placeholder links to nav (alerts for coming soon)
- Hero CTAs now auto-select matching tabs (Charter→charter tab, Private→private tab, etc.)

### Overlord — Ai Chan Deep Fix
- Nami's Prompt Guard blocks caused by wrong LID in profile
- WhatsApp sends LID `84267677782098`, profile only had `13135550002`
- Root cause: `docker restart` doesn't rebuild — code was baked into image, LID fix never deployed
- Full container rebuild (`docker compose up -d --build`) required to deploy code changes
- Added debug log confirming guard bypass for trusted users
- Increased power user turn limit 20 → 40 for content creation sessions
- Updated Nami's memory with full website redesign progress (hero copy, target audience, credentials)
- Fixed `senderProfile` naming collision that crashed container on first rebuild

## 2026-02-22

### Workspace Enhancement (Phase 1-4)
- Built full OVERLORD workspace structure around existing WhatsApp bot (NOT a rebuild)
- New workspace files: CLAUDE.md (enhanced), IDENTITY.md, USER.md, MEMORY.md, BRAIN.md, INBOX.md, PLAYBOOK.md, VOICE.md, STATUS.md, CHANGELOG.md
- 9 skill modules with SKILL.md each + 4 executable tool sets (monitoring, web-scraper, api-integrations, data-analysis)
- 6 utility scripts: health-check.sh, backup.sh, update-status.sh, morning-brief.sh, auto-journal.sh, codex-review.sh
- Dockerfile expanded: Docker CLI, GitHub CLI, Python 3 + pip packages, llm + OpenRouter plugin, Codex CLI, Claude CLI
- docker-compose.yml: mounts for Docker socket, git creds, Claude CLI dirs, Codex auth, all projects
- Created `gil` user (sudo, docker, passwordless sudo, SSH via Tailscale)

### LLM Tools (Phase 5)
- Installed `llm` CLI (v0.28) with `llm-openrouter` plugin — 26+ free models
- OpenRouter key configured, auto-sets on container start

### Codex CLI (Phase 6)
- Installed Codex CLI (v0.104.0) — free code review via ChatGPT account auth (NOT API)
- Codex caught 4 real bugs total across the session

### Bot Upgrades (Phase 7) — 6 features deployed
1. Media Sending via Baileys
2. Auto-Split at paragraph boundaries with (1/N) numbering
3. Express HTTP Server on port 3001 (send, github/coolify/generic webhooks)
4. Voice Transcription via Groq Whisper API (free)
5. Screenshots via puppeteer-core + Chromium
6. Multi-message combined with auto-split

### Cleanup
- Deleted stale copies, pruned old Docker images (~2.8GB)

## 2026-02-23

### SurfaBabe v1.0 — Built & Deployed
- New repo `bluemele/SurfaBabe` — stripped Overlord fork for SurfaBabe Wellness (Ailie's business)
- 16 files, 7 products with VND pricing, bilingual EN/VI
- Order state machine, silent mode default, connected to Ailie's WhatsApp Business

### Overlord Bug Fix — LID Resolution
- Fixed Gil getting Sonnet instead of Opus in group chats (LID mismatch)

### Agent Isolation & Family Profiles
- Britt (Ailie), Ai Chan (Nami), Dex (Seneca) sub-agents
- Group chat: always Overlord/Sage; personal agents only in DMs
- Power user sandboxing, /newproject workflow
- Family members added: Monet, Ayisha, Nephew, Alan

### X/Twitter Trends Skill
- Created `skills/x-trends/xtrends.py` — trends (with fallback scrapers), search, user subcommands
- twikit for auth-based access, GetDayTrends.com + Trends24.in fallbacks for trends
- File-based caching at /tmp/x_cache/
- Added twikit to Dockerfile pip install
- X_USERNAME/X_EMAIL/X_PASSWORD added to .env (empty — needs Gil's burner account)
- Registered in CLAUDE.md and REGISTRY.md

### MasterCommander Landing Page
- Dark nautical theme, interactive SVG flow diagram with animated data pulses
- Three communication tiers: On Board, Remote (WhatsApp), Master (Cloud)
- Click-to-inspect nodes, responsive design
- Commander Unit prototype code (digestion module) — alert engine, SignalK, LLM router, WhatsApp, simulator

## 2026-02-24

### AI Chan / NamiBarden Incident — Investigated & Fixed
- **Root cause:** Claude CLI credits exhausted mid-session → file edits orphaned (on disk, never committed)
- AI Chan attempted self-recovery by running `docker build` + `docker run` directly (bypassed prompt-only restrictions)
- Rogue container `namibarden-web-1` created on bridge network — Traefik never routed to it
- **Fix:** Stopped rogue container, committed orphaned changes (`eecdd43`), rebuilt Coolify container manually
- NamiBarden has NO GitHub webhook — manual deploy required via `docker compose up -d --force-recreate`
- **TODOs:** Set up Coolify webhook for NamiBarden; enforce power user restrictions at tool level

### NamiBarden Deploy Fix
- `triggerDeploy()` now hot-copies `public/` into container via `docker cp` after git push
- Dynamic container lookup via Coolify Docker labels (survives recreates)
- Codex reviewed: fixed both P2 issues (hardcoded name, misleading success on failure)

### Fail2ban Traefik Jails
- Enabled Traefik access logging (`/data/coolify/proxy/access.log`, 4xx only)
- 3 new jails: `traefik-auth` (401 brute force), `traefik-botsearch` (path scanners), `traefik-ratelimit` (excessive 4xx)
- Logrotate configured (14 days, compressed, daily)
- All filters tested and verified against real + synthetic log lines

### Morning Briefing Overhaul
- Container name resolver: maps Coolify hash names → human-readable (NamiBarden, BeastMode, Lumina, etc.)
- Uses Docker labels (`coolify.serviceName`, `coolify.projectName`) with static fallback map
- Added fail2ban stats section to briefing
- Cleaner memory format (one-line instead of raw `free -h`)
- Log monitor alerts also use friendly names now
- Schedule changed from 8am → 6am (Gil wakes ~5:30am)
- Both scheduler.js (WhatsApp) and morning-brief.sh (log file) updated
- Codex reviewed: clean, no issues

### Error Auto-Fix Protocol (saved to memory)
- Errors detected anywhere → Overlord investigates + attempts fix + codex reviews + reports outcome
- Gil never sees raw errors, only post-investigation reports

### Disaster Recovery Setup
- Created `server-config/` in Overlord repo with all critical configs
- Updated `backup.sh` to auto-sync server-config + Claude CLI memory/skills nightly
- Updated `.gitignore` to track chat memories

### MasterCommander — Charter Fleet Website Update
- **Major site overhaul:** Expanded from private-yacht-only to triple-audience (charter fleets + private yachts + delivery/marina)
- **67+ use cases** presented in tabbed Solutions section:
  - Charter tab (3 sub-pills): During Charter (13), Turnaround (6), Fleet Dashboard (9)
  - Private tab (2 sub-pills): Active Boating (11), Away From Boat (9)
  - Delivery Puck section: Delivery Monitoring, Marina Management, Seasonal Storage
  - "Also Built For" ribbon: Insurance (4), Service (2)
- **Delivery Puck product:** New dedicated section with kit contents (~$370 hardware), 3-step setup, data flow chain (NMEA→Actisense→Pi→4G→Tailscale→Master→WhatsApp), three use cases (delivery, marina, storage)
- **Three hardware tiers:** Raspberry Pi (charter), Delivery Puck (delivery/marina), Mac Mini M4 (private)
- **Three pricing tiers:** $240/yr charter, ~$370 puck, Custom private
- **Card interactivity fix:** Removed permanent "featured" green border stuck on left cards. All cards now have hover glow + lift. Hardware cards scroll to pricing on click. Pricing cards trigger email on click.
- Updated: hero (dual CTA), nav, social proof bar, features, Master Cloud copy, CTA (dual buttons), footer
- Removed old Fleet section (absorbed into Solutions tabs)
- Deployed via `docker cp` to mastercommander container

### FleetMind — Crowdsourced Fleet Intelligence
- New section on site: 6 capabilities (live wind field, crowdsourced depth, anchorage intel, passage conditions, hazard broadcasts, weather alerts)
- FleetMind card replaced Master Cloud in features grid
- Added to charter pricing plan inclusions
- CSS: `.fleetmind-hero`, `.fleetmind-grid`, `.fm-card`, `.fleetmind-note`

### Chat Widget + WhatsApp Links
- **WhatsApp click-to-chat:** All mailto links replaced with `https://wa.me/13055601031?text=...` (context-specific pre-filled messages)
- **Web chat widget:** Floating bubble + chat window on mastercommander.namibarden.com
  - Frontend: CSS + JS in index.html — WhatsApp-style dark UI, session persistence
  - Backend: `POST /api/web-chat` endpoint in Overlord's server.js
  - Direct OpenRouter API call (fetch) using `openai/gpt-4.1-nano` — non-reasoning, fast, ~$0.0003/request
  - CORS for mastercommander.namibarden.com, rate limiting (10/min/IP), session management (30-min expiry, 20-message history)
  - MC_SYSTEM_PROMPT with product info, pricing, hardware, capabilities
- **Traefik route:** `mastercommander.namibarden.com/api/web-chat` → Overlord container port 3001 (priority 100)
- **Pricing CTA refactor:** Removed per-card buttons (Get Started/Inquire/Contact Us), replaced with shared row below all cards: "Chat with Overlord Live" (opens widget) + "Contact Us on WhatsApp"

### System Architecture — Charter/Private Tabs
- Flow diagram now has two tabs: **Charter Fleet** (Raspberry Pi + Cloud AI) and **Private Yacht** (Mac Mini M4 + Local AI)
- Charter mode: Raspberry Pi commander, Cloud AI sub-module (purple, via Master), FleetMind node, Master = included (purple), Fleet Dashboard
- Private mode: Mac Mini M4 commander, AI Brain sub-module (green, local Qwen 14B), Master = optional (gray)
- Nodes, connections, details, tags, and colors all switch per mode
- flow.js rewritten: shared nodes/connections + mode-specific overrides, `setFlowMode()` exposed globally for tab buttons
- Tab buttons styled to match Solutions tabs pattern
- **Charter flow cleanup:** Removed Bluetooth, Commander App, and on-board path from charter mode — charterers only use WhatsApp + web dashboard. Phone node repositioned to WhatsApp y-level. Private mode retains full on-board path (WiFi/BLE → Commander App → Phone).
- **Pricing update:** $240/yr → $499/yr per boat across all references (hero CTA, proof bar, hardware spec, pricing card, meta description)
  - Service: `overlord-api` at `http://overlord:3001` in namibarden.yaml
- **Model choice notes:** `openrouter/auto` picks gpt-5-nano (reasoning model) which burns all tokens on thinking → empty content. Free models frequently rate-limited. gpt-4.1-nano is the sweet spot.
- **Architecture diagram cleanup** (based on Codex + Gemini + DeepSeek R1 reviews):
  - Removed Cloud AI sub-module from Charter Commander (architecturally wrong — AI goes through Starlink→Master, not Commander)
  - Removed Alert Engine and Quick Cmds shared sub-modules (redundant with Features section)
  - Kept Auto-Discovery (architecturally meaningful) and AI Brain for Private (local on Mac Mini)
  - Updated Charter Commander description: "forwards to Master Cloud for AI processing"
  - Updated Charter Master description: "All AI processing happens here"
  - Result: cleaner diagram, correct data flow, no feature duplication

### Pushes
- SurfaBabe: Renamed bot identity from "SurfaBabe" to "Britt" (CLAUDE.md + index.js)
- Overlord: Auto-journal, deploy fix, briefing overhaul, disaster recovery (`21707ab` → multiple commits)
- Overlord: Web chat endpoint (`2f85407`, `b098b2c`)
- MasterCommander: 10 commits (`401bcb9`→`9333fc3`) — charter fleet, delivery puck, pill rename, pricing fix, card interactivity, FleetMind, chat widget, pricing CTA refactor, architecture tabs, diagram cleanup
