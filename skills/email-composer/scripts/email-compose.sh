#!/bin/bash
# email-composer — Compose and send emails via gws CLI (Gmail API)
# Usage: email-compose.sh <command> [args...]
set -euo pipefail

FROM_ADDR="overlord.gil.ai@gmail.com"
FROM_NAME="Gil"

# ── HELPERS ──────────────────────────────────────────────────────────────────

# URL-safe base64 encode (RFC 4648 §5): replace +/ with -_, strip padding/newlines
b64_url_encode() {
  base64 -w0 | tr '+/' '-_' | tr -d '='
}

# Build RFC 2822 message and return URL-safe base64
build_message() {
  local to="$1" subject="$2" body="$3"
  local date_header
  date_header=$(date -R)
  local msg_id="<$(date +%s).$$@overlord.gil.ai>"

  printf '%s\r\n' \
    "MIME-Version: 1.0" \
    "From: ${FROM_NAME} <${FROM_ADDR}>" \
    "To: ${to}" \
    "Subject: ${subject}" \
    "Date: ${date_header}" \
    "Message-ID: ${msg_id}" \
    "Content-Type: text/plain; charset=UTF-8" \
    "Content-Transfer-Encoding: 7bit" \
    "" \
    "${body}" | b64_url_encode
}

# Build RFC 2822 reply message
build_reply_message() {
  local to="$1" subject="$2" body="$3" in_reply_to="$4" references="$5"
  local date_header
  date_header=$(date -R)
  local msg_id="<$(date +%s).$$@overlord.gil.ai>"

  printf '%s\r\n' \
    "MIME-Version: 1.0" \
    "From: ${FROM_NAME} <${FROM_ADDR}>" \
    "To: ${to}" \
    "Subject: ${subject}" \
    "Date: ${date_header}" \
    "Message-ID: ${msg_id}" \
    "In-Reply-To: ${in_reply_to}" \
    "References: ${references}" \
    "Content-Type: text/plain; charset=UTF-8" \
    "Content-Transfer-Encoding: 7bit" \
    "" \
    "${body}" | b64_url_encode
}

# Extract a header value from gws message JSON
extract_header() {
  local json="$1" header_name="$2"
  echo "$json" | grep -oP "\"name\":\\s*\"${header_name}\",\\s*\"value\":\\s*\"\\K[^\"]*" | head -1
}

# ── COMMANDS ─────────────────────────────────────────────────────────────────

cmd_send() {
  local to="${1:?Usage: email-compose.sh send <to> <subject> <body>}"
  local subject="${2:?Usage: email-compose.sh send <to> <subject> <body>}"
  local body="${3:?Usage: email-compose.sh send <to> <subject> <body>}"

  local raw
  raw=$(build_message "$to" "$subject" "$body")

  local result
  result=$(gws gmail users messages send --params '{"userId":"me"}' --json "{\"raw\":\"${raw}\"}" 2>&1)

  local msg_id
  msg_id=$(echo "$result" | grep -oP '"id":\s*"\K[^"]*' | head -1)

  if [ -n "$msg_id" ]; then
    echo "Sent. Message ID: ${msg_id}"
  else
    echo "ERROR: Send failed"
    echo "$result"
    return 1
  fi
}

cmd_draft() {
  local to="${1:?Usage: email-compose.sh draft <to> <subject> <body>}"
  local subject="${2:?Usage: email-compose.sh draft <to> <subject> <body>}"
  local body="${3:?Usage: email-compose.sh draft <to> <subject> <body>}"

  local raw
  raw=$(build_message "$to" "$subject" "$body")

  local result
  result=$(gws gmail users drafts create --params '{"userId":"me"}' --json "{\"message\":{\"raw\":\"${raw}\"}}" 2>&1)

  local draft_id
  draft_id=$(echo "$result" | grep -oP '"id":\s*"\K[^"]*' | head -1)

  if [ -n "$draft_id" ]; then
    echo "Draft created. Draft ID: ${draft_id}"
  else
    echo "ERROR: Draft creation failed"
    echo "$result"
    return 1
  fi
}

cmd_reply() {
  local message_id="${1:?Usage: email-compose.sh reply <message_id> <body>}"
  local body="${2:?Usage: email-compose.sh reply <message_id> <body>}"

  # Fetch original message to get headers
  local orig
  orig=$(gws gmail users messages get --params "{\"userId\":\"me\",\"id\":\"${message_id}\",\"format\":\"metadata\",\"metadataHeaders\":[\"From\",\"To\",\"Subject\",\"Message-ID\",\"References\"]}" 2>&1)

  local orig_from orig_subject orig_msg_id orig_references thread_id
  orig_from=$(extract_header "$orig" "From")
  orig_subject=$(extract_header "$orig" "Subject")
  orig_msg_id=$(extract_header "$orig" "Message-ID")
  orig_references=$(extract_header "$orig" "References")
  thread_id=$(echo "$orig" | grep -oP '"threadId":\s*"\K[^"]*' | head -1)

  if [ -z "$orig_from" ]; then
    echo "ERROR: Could not fetch original message ${message_id}"
    echo "$orig"
    return 1
  fi

  # Build reply subject
  local reply_subject="$orig_subject"
  if ! echo "$reply_subject" | grep -qi '^Re:'; then
    reply_subject="Re: ${reply_subject}"
  fi

  # Build references chain
  local references="${orig_references:+${orig_references} }${orig_msg_id}"

  # Reply goes to original sender
  local reply_to="$orig_from"

  local raw
  raw=$(build_reply_message "$reply_to" "$reply_subject" "$body" "$orig_msg_id" "$references")

  local result
  result=$(gws gmail users messages send --params '{"userId":"me"}' --json "{\"raw\":\"${raw}\",\"threadId\":\"${thread_id}\"}" 2>&1)

  local new_msg_id
  new_msg_id=$(echo "$result" | grep -oP '"id":\s*"\K[^"]*' | head -1)

  if [ -n "$new_msg_id" ]; then
    echo "Reply sent. Message ID: ${new_msg_id} (thread: ${thread_id})"
  else
    echo "ERROR: Reply failed"
    echo "$result"
    return 1
  fi
}

cmd_template() {
  local name="${1:?Usage: email-compose.sh template <name>}"

  case "$name" in
    marina)
      cat <<'TPL'
Subject: {{SUBJECT}}

Hi {{TO}},

I'm reaching out regarding slip availability at your marina. I'm looking for a spot for my vessel and wanted to inquire about:

- Available slips and pricing
- Lease terms and requirements
- Amenities (power, water, pump-out, WiFi)
- Any current waitlist

{{BODY}}

Looking forward to hearing from you.

Best regards,
Gil
TPL
      ;;
    invoice)
      cat <<'TPL'
Subject: {{SUBJECT}}

Hi {{TO}},

I'm following up on the outstanding invoice referenced below.

{{BODY}}

Could you please confirm receipt and let me know the expected payment timeline? Happy to discuss if there are any questions.

Thank you,
Gil
TPL
      ;;
    follow-up)
      cat <<'TPL'
Subject: {{SUBJECT}}

Hi {{TO}},

It was great connecting with you. I wanted to follow up on our conversation.

{{BODY}}

Let me know if you'd like to continue the discussion or if there's anything else I can help with.

Best,
Gil
TPL
      ;;
    intro)
      cat <<'TPL'
Subject: {{SUBJECT}}

Hi {{TO}},

My name is Gil. I'm reaching out because I think there could be a good opportunity for us to connect.

{{BODY}}

I'd love to set up a quick call to discuss further. Let me know what works for your schedule.

Cheers,
Gil
TPL
      ;;
    *)
      echo "Unknown template: $name"
      echo "Available: marina, invoice, follow-up, intro"
      return 1
      ;;
  esac
}

cmd_list_templates() {
  echo "Available templates:"
  echo ""
  printf "  %-12s %s\n" "marina"    "Professional marina/dock communication"
  printf "  %-12s %s\n" "invoice"   "Payment follow-up"
  printf "  %-12s %s\n" "follow-up" "General follow-up after meeting"
  printf "  %-12s %s\n" "intro"     "Introduction email"
  echo ""
  echo "Usage: email-compose.sh template <name>"
}

# ── USAGE ────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
email-composer — Compose and send emails via Gmail API (gws CLI)

SEND & DRAFT:
  email-compose.sh send <to> <subject> <body>     Send an email
  email-compose.sh draft <to> <subject> <body>    Create a draft
  email-compose.sh reply <message_id> <body>       Reply to a message

TEMPLATES:
  email-compose.sh template <name>                 Show a template
  email-compose.sh list-templates                  List available templates

EXAMPLES:
  email-compose.sh send "john@example.com" "Hello" "Just checking in."
  email-compose.sh draft "jane@example.com" "Proposal" "Attached is the proposal."
  email-compose.sh reply "18f3a2b4c5d6e7f8" "Thanks, sounds good!"
  email-compose.sh template follow-up
  email-compose.sh list-templates

From address: overlord.gil.ai@gmail.com (always)
USAGE
}

# ── MAIN ─────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  send)             cmd_send "$@" ;;
  draft)            cmd_draft "$@" ;;
  reply)            cmd_reply "$@" ;;
  template|tpl)     cmd_template "$@" ;;
  list-templates)   cmd_list_templates ;;
  help|--help|-h)   usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: email-compose.sh help"
    exit 1
    ;;
esac
