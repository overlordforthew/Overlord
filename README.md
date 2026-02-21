# Overlord — WhatsApp ↔ Claude Code Bridge v2.0

A full-featured WhatsApp AI assistant powered by Claude CLI. Lightweight OpenClaw replacement.

**No Meta Business API.** No API costs (uses your Max subscription). No config file nightmares.

## Architecture

```
WhatsApp Message (any type)
    ↓
Baileys (WhatsApp Web bridge)
    ↓
Message Parser (text/image/doc/audio/location/contact/sticker/poll)
    ↓
Media Downloader (saves to disk)
    ↓
Smart Triage (should I respond?)
    ↓
Message Batcher (groups rapid-fire messages)
    ↓
Claude CLI (claude -p with full context + media references)
    ↓
Response → WhatsApp
```

## Features

| Feature | Details |
|---|---|
| **All message types** | Text, images, video, audio, voice notes, PDFs, docs, stickers, contacts, location, polls |
| **Image analysis** | Downloads images, passes to Claude for description/OCR |
| **Document analysis** | PDFs, DOCX, XLSX, CSV, TXT — all analyzed by Claude |
| **Smart responses** | Reads ALL messages, uses AI triage to decide when to respond |
| **3 response modes** | `all` (respond to everything), `smart` (AI decides), `mention` (trigger words only) |
| **Message batching** | Waits for rapid-fire messages before responding |
| **Per-chat memory** | Persistent memory.md per conversation |
| **Session continuity** | Resumes Claude sessions across messages |
| **Reply context** | Understands quoted/reply messages |
| **Rolling context** | Keeps last 50 messages per chat as context |
| **Admin/user perms** | Admin gets shell access, others get chat only |
| **Rate limiting** | Per-contact rate limits |
| **Conversation logs** | JSONL logs per chat |
| **Group chat aware** | Smart participation in group conversations |
| **Systemd service** | Auto-start, auto-restart, journalctl logs |

## Quick Start

```bash
# On your Hetzner server
git clone https://github.com/bluemele/Overlord.git /root/overlord
cd /root/overlord
chmod +x setup.sh
./setup.sh

# First run — scan QR code
node index.js

# After linking, run as service
systemctl start whatsapp-claude
journalctl -u whatsapp-claude -f
```

## Response Modes

### `smart` (default)
Bot reads every message but uses AI to decide when to respond. Responds to:
- Direct mentions of its name
- Replies to its messages
- Unanswered questions
- Shared media without context
- Conversations where it has useful input

### `all`
Responds to every single message. Good for DM-only bots.

### `mention`
Only responds when trigger words are used. Most conservative.

Change modes via WhatsApp:
```
/mode smart
/mode all
/mode mention
/threshold 0.7    (make smart mode more chatty)
/threshold 0.2    (make it quieter)
```

## WhatsApp Commands

| Command | Who | Description |
|---|---|---|
| `/help` | All | Show commands |
| `/status` | Admin | Server status |
| `/memory` | All | View chat memory |
| `/clear` | All | Reset session |
| `/context` | All | Show message buffer |
| `/mode` | All | View current mode |
| `/mode <mode>` | Admin | Change mode |
| `/threshold <n>` | Admin | Set smart chattiness (0.0-1.0) |

## Configuration

### Environment (.env)
```
ADMIN_NUMBER=18681234567
BOT_NAME=Claude
CLAUDE_PATH=claude
CLAUDE_MODEL=
RESPONSE_MODE=smart
CHIME_THRESHOLD=0.5
LOG_LEVEL=info
```

### In-Code (CONFIG object in index.js)
- `batchWindowMs` — How long to wait for rapid messages (default: 2000ms)
- `contextWindowSize` — Rolling context depth (default: 50 messages)
- `maxMediaSizeMB` — Max file download size (default: 25MB)
- `maxResponseTime` — Claude timeout (default: 3 min)
- `maxMessagesPerMinute` — Rate limit (default: 15)

## Extending with MCP Servers

Claude CLI supports MCP servers (plugins). These replace OpenClaw's "skills":

```bash
# Web search
claude mcp add web-search -- npx @anthropic-ai/mcp-server-web-search

# Database access
claude mcp add my-db -- npx @anthropic-ai/mcp-server-postgres "postgresql://..."

# GitHub
claude mcp add github -- npx @anthropic-ai/mcp-server-github

# File system
claude mcp add files -- npx @anthropic-ai/mcp-server-filesystem /path/to/dir
```

### Custom X/Twitter Integration
Create a script Claude can call:
```bash
mkdir -p /root/tools
cat > /root/tools/x-search.sh << 'EOF'
#!/bin/bash
curl -s -H "Authorization: Bearer $TWITTER_BEARER_TOKEN" \
  "https://api.x.com/2/tweets/search/recent?query=$1&max_results=10"
EOF
chmod +x /root/tools/x-search.sh
```

## File Structure

```
overlord/
├── index.js                    # Main application
├── CLAUDE.md                   # Bot personality
├── package.json
├── .env
├── setup.sh
├── whatsapp-claude.service
├── auth/                       # WhatsApp session
├── data/
│   └── <contact>/
│       ├── memory.md           # Persistent memory
│       ├── session_id          # Claude session
│       └── media/              # Downloaded files
│           ├── 1708012345_photo.jpg
│           └── 1708012345_document.pdf
└── logs/
    └── <contact>.jsonl         # Conversation logs
```

## Troubleshooting

| Issue | Fix |
|---|---|
| QR won't scan | Delete `./auth/`, restart |
| No responses | Check `journalctl -u whatsapp-claude -f` |
| Claude errors | Test: `echo "hi" \| claude -p` |
| Session expired | Restart service, re-scan if needed |
| Media not analyzed | Check file was saved in `data/<contact>/media/` |
| Too chatty | `/threshold 0.2` or `/mode mention` |
| Too quiet | `/threshold 0.8` or `/mode all` |
