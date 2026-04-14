---
name: notification-hub
version: 1.0.0
description: "Multi-channel notification delivery with automatic fallback — WhatsApp, Discord, and Email."
---

# Notification Hub

Send notifications through WhatsApp, Discord, or Email with automatic fallback when a channel is unavailable.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `notify.sh send <msg> [--channel X] [--to EMAIL]` | Send with fallback chain (default) or specific channel |
| `notify.sh whatsapp <msg>` | Queue message via WhatsApp outbox |
| `notify.sh discord <msg>` | Send to Discord webhook |
| `notify.sh email <to> <subject> <msg>` | Send email via gws CLI |
| `notify.sh test` | Test all channels, report which work |
| `notify.sh status` | Check channel availability |

## Channels

| Channel | Mechanism | Config |
|---------|-----------|--------|
| WhatsApp | File outbox at `/tmp/wa-outbox.json`, picked up every 10s by bot scheduler | Admin JID hardcoded |
| Discord | HTTP POST to webhook URL | `DISCORD_WEBHOOK_URL` in env or `/root/overlord/.env` |
| Email | `gws gmail users messages send` (Gmail API) | Authenticated as `overlord.gil.ai@gmail.com` |

## Fallback Chain (default `send` behavior)

1. Write to WhatsApp outbox, wait up to 15s for bot to pick it up
2. If WhatsApp fails, send via Discord webhook
3. If Discord fails, send email to Gil

## Usage

```bash
# Smart send with fallback
/root/overlord/skills/notification-hub/scripts/notify.sh send "Server restarted"

# Force a specific channel
/root/overlord/skills/notification-hub/scripts/notify.sh send "Alert" --channel discord

# Send to all channels at once
/root/overlord/skills/notification-hub/scripts/notify.sh send "Critical alert" --channel all

# Direct channel commands
/root/overlord/skills/notification-hub/scripts/notify.sh discord "Deploy complete"
/root/overlord/skills/notification-hub/scripts/notify.sh email "someone@example.com" "Subject" "Body"
/root/overlord/skills/notification-hub/scripts/notify.sh whatsapp "Quick update"

# Diagnostics
/root/overlord/skills/notification-hub/scripts/notify.sh status
/root/overlord/skills/notification-hub/scripts/notify.sh test
```

## Dependencies

- `curl` and `jq` — Discord webhook delivery
- `gws` CLI — Email delivery (Gmail API, pre-authenticated)
- `base64` — RFC 2822 message encoding
- Overlord bot container — WhatsApp outbox pickup (scheduler.js)

## Environment

| Variable | Source | Required for |
|----------|--------|-------------|
| `DISCORD_WEBHOOK_URL` | `/root/overlord/.env` or shell env | Discord channel |

## Notes

- WhatsApp outbox messages expire after 5 minutes (enforced by scheduler.js)
- Discord webhook returns HTTP 204 on success
- Email uses the same `gws` pattern as the email-composer skill
- The `test` command sends to all three channels independently (does not use fallback)
