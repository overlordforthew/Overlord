---
name: email-composer
version: 1.0.0
description: "Compose and send emails via Gmail API using gws CLI. Supports send, draft, reply, and built-in templates."
---

# Email Composer

Send and draft emails from `overlord.gil.ai@gmail.com` using the gws CLI (Gmail API).

## Quick Reference

| Command | What it does |
|---------|-------------|
| `email-compose.sh send <to> <subject> <body>` | Send an email |
| `email-compose.sh draft <to> <subject> <body>` | Create a draft |
| `email-compose.sh reply <message_id> <body>` | Reply to a message (auto-threads) |
| `email-compose.sh template <name>` | Show a built-in template |
| `email-compose.sh list-templates` | List available templates |

## Usage

Scripts are at:
- Host: `/root/overlord/skills/email-composer/scripts/email-compose.sh`
- Container: `/app/skills/email-composer/scripts/email-compose.sh`

### Send an email

```bash
email-compose.sh send "john@example.com" "Meeting tomorrow" "Hi John, confirming our 2pm meeting tomorrow. See you there."
```

### Create a draft (review before sending)

```bash
email-compose.sh draft "client@company.com" "Project Update" "Here's the latest on the project..."
```

### Reply to a message

```bash
# Get message ID from gws gmail users messages list
email-compose.sh reply "18f3a2b4c5d6e7f8" "Thanks, that works for me!"
```

The reply command automatically:
- Fetches original headers (From, Subject, Message-ID, References)
- Sets In-Reply-To and References for proper threading
- Prepends "Re:" to subject if not already present
- Sends in the same thread

### Templates

```bash
email-compose.sh list-templates
email-compose.sh template marina
email-compose.sh template follow-up
```

Available templates: `marina`, `invoice`, `follow-up`, `intro`

Templates show placeholder text with `{{TO}}`, `{{SUBJECT}}`, `{{BODY}}` markers. Use them as a starting point — copy the body text and pass it to `send` or `draft`.

## How It Works

1. Builds an RFC 2822 message with proper headers (From, To, Subject, Date, MIME-Version, Content-Type)
2. Base64-encodes the entire message using URL-safe encoding (RFC 4648)
3. Calls `gws gmail users messages send` (or `drafts create`) with the encoded payload
4. Returns the Gmail message/draft ID on success

## When to Use

- Sending emails on Gil's behalf (always from overlord.gil.ai@gmail.com)
- Creating drafts for Gil to review before sending
- Replying to existing email threads
- Quick outreach using built-in templates as starting points
