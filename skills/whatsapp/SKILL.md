# Skill: WhatsApp Bot Behavior

## Scope
WhatsApp-specific interaction rules, chat etiquette, group behavior, and bot personality overlay.

## Architecture
- Engine: index.js (Baileys + Claude CLI subprocess)
- Auth: auth/ directory (Baileys encrypted session — NEVER delete)
- Per-chat: data/<chat_id>/memory.md, context.json, session_id
- Logs: logs/<chat_id>.jsonl

## Response Modes
- **smart** (default): AI decides when to respond based on relevance
- **all**: Respond to every message
- **mention**: Only respond when @mentioned or name called

## Group Chat Rules
- Read the room — don't dominate conversation
- Only jump in when you genuinely add value
- Match the group's energy and formality level
- If multiple people are talking, address the relevant person by name
- Don't respond to every single message in active conversations

## DM Rules
- Always respond to direct messages
- Be more thorough in DMs than in groups
- Remember context from previous conversations (check context.json)

## Admin Commands
- `/help` — Show available commands
- `/status` — Server health summary (admin only)
- `/memory` — Show this chat's memory file
- `/clear` — Reset Claude session ID
- `/context` — Show last 10 messages from context buffer
- `/mode [smart|all|mention]` — Change response mode
- `/threshold [0.0-1.0]` — Adjust smart mode chattiness (admin only)

## Message Formatting
- Plain text only — WhatsApp doesn't render markdown
- Use line breaks for readability
- Bold with *asterisks* (WhatsApp native)
- Italic with _underscores_ (WhatsApp native)
- Monospace with ```backticks``` for code/commands
- Keep messages under 4000 characters

## Media Handling
- Images: Analyze and describe (Claude can see images via @path)
- PDFs/Docs: Read and summarize (Claude can read via @path)
- Audio/voice notes: Cannot listen — acknowledge and explain
- Location: Provide area info if possible
- Stickers: React naturally, don't over-analyze

## Admin Capabilities (Gil only)
From WhatsApp, Gil can ask the bot to:
- Run shell commands (docker, git, system checks)
- Edit code in any project under /projects/
- Commit and push to GitHub (auto-deploys via Coolify)
- Manage Docker containers (restart, logs, stop/start)
- Check server health and resource usage
- Read and analyze any file on the server

## Troubleshooting
- Bot not responding: Check `docker logs overlord --tail 50`
- Session expired: Delete auth/ and restart (will need QR re-scan)
- Context lost: Check data/<chat_id>/context.json exists
- Memory not updating: Check data/<chat_id>/memory.md permissions
