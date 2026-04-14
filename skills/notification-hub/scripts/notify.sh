#!/bin/bash
# notification-hub — Multi-channel notification delivery with fallback
# Channels: WhatsApp (outbox), Discord (webhook), Email (gws CLI)
# Usage: notify.sh <command> [args...]
set -euo pipefail

# ── CONFIG ───────────────────────────────────────────────────────────────────

ADMIN_JID="18587794588@s.whatsapp.net"
ADMIN_EMAIL="overlord.gil.ai@gmail.com"
FROM_NAME="Overlord"
OUTBOX_PATH="/tmp/wa-outbox.json"
ENV_FILE="/root/overlord/.env"

# Load DISCORD_WEBHOOK_URL from environment or .env file
if [ -z "${DISCORD_WEBHOOK_URL:-}" ] && [ -f "$ENV_FILE" ]; then
  DISCORD_WEBHOOK_URL=$(grep -oP '^DISCORD_WEBHOOK_URL=\K.*' "$ENV_FILE" 2>/dev/null | tr -d '"' || true)
fi
DISCORD_WEBHOOK_URL="${DISCORD_WEBHOOK_URL:-}"

# ── HELPERS ──────────────────────────────────────────────────────────────────

# URL-safe base64 encode (RFC 4648 section 5)
b64_url_encode() {
  base64 -w0 | tr '+/' '-_' | tr -d '='
}

# Build RFC 2822 message and return URL-safe base64
build_email_raw() {
  local to="$1" subject="$2" body="$3"
  local date_header
  date_header=$(date -R)
  local msg_id="<$(date +%s).$$@overlord.gil.ai>"

  printf '%s\r\n' \
    "MIME-Version: 1.0" \
    "From: ${FROM_NAME} <${ADMIN_EMAIL}>" \
    "To: ${to}" \
    "Subject: ${subject}" \
    "Date: ${date_header}" \
    "Message-ID: ${msg_id}" \
    "Content-Type: text/plain; charset=UTF-8" \
    "Content-Transfer-Encoding: 7bit" \
    "" \
    "${body}" | b64_url_encode
}

# ── CHANNEL SENDERS ──────────────────────────────────────────────────────────

# Send via WhatsApp outbox file. Returns 0 if the file was written and picked up.
send_whatsapp() {
  local message="$1"
  local ts
  ts=$(date +%s%3N)

  # Write the outbox file
  printf '{"jid":"%s","text":"%s","ts":%s}\n' \
    "$ADMIN_JID" \
    "$(echo "$message" | sed 's/"/\\"/g' | sed ':a;N;$!ba;s/\n/\\n/g')" \
    "$ts" > "$OUTBOX_PATH"

  echo "[whatsapp] Queued message to outbox (${#message} chars)"
  return 0
}

# Send via WhatsApp and verify pickup within timeout
send_whatsapp_verified() {
  local message="$1"
  local timeout="${2:-15}"

  send_whatsapp "$message"

  # Wait for the scheduler to pick up the file (checks every 10s)
  local elapsed=0
  while [ $elapsed -lt "$timeout" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ ! -f "$OUTBOX_PATH" ]; then
      echo "[whatsapp] Message picked up after ${elapsed}s"
      return 0
    fi
  done

  echo "[whatsapp] WARNING: Message not picked up within ${timeout}s (file still exists)"
  return 1
}

# Send via Discord webhook
send_discord() {
  local message="$1"

  if [ -z "$DISCORD_WEBHOOK_URL" ]; then
    echo "[discord] ERROR: DISCORD_WEBHOOK_URL not configured"
    return 1
  fi

  local response http_code
  response=$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg content "$message" '{content: $content}')" \
    "$DISCORD_WEBHOOK_URL" 2>&1)

  http_code="$response"
  if [ "$http_code" = "204" ] || [ "$http_code" = "200" ]; then
    echo "[discord] Sent (HTTP ${http_code}, ${#message} chars)"
    return 0
  else
    echo "[discord] ERROR: HTTP ${http_code}"
    return 1
  fi
}

# Send via email (gws CLI)
send_email() {
  local to="$1" subject="$2" body="$3"

  local raw
  raw=$(build_email_raw "$to" "$subject" "$body")

  local result
  result=$(gws gmail users messages send --params '{"userId":"me"}' --body "{\"raw\":\"${raw}\"}" 2>&1)

  local msg_id
  msg_id=$(echo "$result" | grep -oP '"id":\s*"\K[^"]*' | head -1)

  if [ -n "$msg_id" ]; then
    echo "[email] Sent to ${to} (Message ID: ${msg_id})"
    return 0
  else
    echo "[email] ERROR: Send failed"
    echo "$result"
    return 1
  fi
}

# ── COMMANDS ─────────────────────────────────────────────────────────────────

cmd_whatsapp() {
  local message="${1:?Usage: notify.sh whatsapp <message>}"
  send_whatsapp "$message"
}

cmd_discord() {
  local message="${1:?Usage: notify.sh discord <message>}"
  send_discord "$message"
}

cmd_email() {
  local to="${1:?Usage: notify.sh email <to> <subject> <message>}"
  local subject="${2:?Usage: notify.sh email <to> <subject> <message>}"
  local message="${3:?Usage: notify.sh email <to> <subject> <message>}"
  send_email "$to" "$subject" "$message"
}

cmd_send() {
  local message=""
  local channel="default"
  local email_to="$ADMIN_EMAIL"

  # Parse arguments
  while [ $# -gt 0 ]; do
    case "$1" in
      --channel)
        channel="${2:?--channel requires a value (all|whatsapp|discord|email)}"
        shift 2
        ;;
      --to)
        email_to="${2:?--to requires an email address}"
        shift 2
        ;;
      *)
        if [ -z "$message" ]; then
          message="$1"
        else
          message="$message $1"
        fi
        shift
        ;;
    esac
  done

  if [ -z "$message" ]; then
    echo "Usage: notify.sh send <message> [--channel all|whatsapp|discord|email] [--to EMAIL]"
    exit 1
  fi

  case "$channel" in
    all)
      echo "=== Sending to ALL channels ==="
      local wa_ok=0 dc_ok=0 em_ok=0
      send_whatsapp "$message" && wa_ok=1 || true
      send_discord "$message" && dc_ok=1 || true
      send_email "$email_to" "Overlord Notification" "$message" && em_ok=1 || true
      echo "--- Results: WhatsApp=$( [ $wa_ok -eq 1 ] && echo OK || echo FAIL ) Discord=$( [ $dc_ok -eq 1 ] && echo OK || echo FAIL ) Email=$( [ $em_ok -eq 1 ] && echo OK || echo FAIL )"
      ;;
    whatsapp)
      send_whatsapp "$message"
      echo "--- Delivered via: WhatsApp"
      ;;
    discord)
      send_discord "$message"
      echo "--- Delivered via: Discord"
      ;;
    email)
      send_email "$email_to" "Overlord Notification" "$message"
      echo "--- Delivered via: Email"
      ;;
    default)
      # Fallback chain: WhatsApp -> Discord -> Email
      echo "=== Attempting delivery with fallback ==="

      if send_whatsapp_verified "$message" 15; then
        echo "--- Delivered via: WhatsApp"
        return 0
      fi

      echo "[fallback] WhatsApp failed, trying Discord..."
      # Remove stale outbox if WhatsApp didn't pick it up
      rm -f "$OUTBOX_PATH"

      if send_discord "$message"; then
        echo "--- Delivered via: Discord (WhatsApp fallback)"
        return 0
      fi

      echo "[fallback] Discord failed, trying Email..."
      if send_email "$email_to" "Overlord Notification" "$message"; then
        echo "--- Delivered via: Email (Discord+WhatsApp fallback)"
        return 0
      fi

      echo "--- ERROR: All channels failed"
      return 1
      ;;
    *)
      echo "Unknown channel: $channel"
      echo "Valid channels: all, whatsapp, discord, email"
      exit 1
      ;;
  esac
}

cmd_test() {
  local ts
  ts=$(date '+%Y-%m-%d %H:%M:%S')
  local test_msg="[Notification Hub Test] ${ts}"
  local results=""

  echo "=== Notification Hub Test ==="
  echo "Timestamp: ${ts}"
  echo ""

  # Test WhatsApp
  echo "--- WhatsApp ---"
  if send_whatsapp "${test_msg} (WhatsApp channel)"; then
    results="${results}WhatsApp: OK\n"
  else
    results="${results}WhatsApp: FAIL\n"
  fi
  echo ""

  # Test Discord
  echo "--- Discord ---"
  if send_discord "${test_msg} (Discord channel)"; then
    results="${results}Discord: OK\n"
  else
    results="${results}Discord: FAIL\n"
  fi
  echo ""

  # Test Email
  echo "--- Email ---"
  if send_email "$ADMIN_EMAIL" "Notification Hub Test" "${test_msg} (Email channel)"; then
    results="${results}Email: OK\n"
  else
    results="${results}Email: FAIL\n"
  fi
  echo ""

  echo "=== Results ==="
  printf "$results"
}

cmd_status() {
  echo "=== Notification Hub Status ==="
  echo ""

  # WhatsApp
  echo "--- WhatsApp ---"
  echo "  Admin JID: ${ADMIN_JID}"
  echo "  Outbox:    ${OUTBOX_PATH}"
  if [ -f "$OUTBOX_PATH" ]; then
    local age
    age=$(( $(date +%s) - $(stat -c %Y "$OUTBOX_PATH") ))
    echo "  Status:    PENDING (outbox file exists, age: ${age}s)"
  else
    echo "  Status:    READY (no pending messages)"
  fi
  # Check if the overlord bot container is running
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^overlord$'; then
    echo "  Bot:       RUNNING"
  else
    echo "  Bot:       NOT RUNNING (messages won't be picked up)"
  fi
  echo ""

  # Discord
  echo "--- Discord ---"
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    echo "  Webhook:   Configured"
    # Quick health check (Discord returns 401 for invalid webhooks on GET)
    local http_code
    http_code=$(curl -s -o /dev/null -w '%{http_code}' "$DISCORD_WEBHOOK_URL" 2>/dev/null || echo "000")
    if [ "$http_code" = "200" ]; then
      echo "  Status:    READY (webhook valid)"
    else
      echo "  Status:    ERROR (HTTP ${http_code})"
    fi
  else
    echo "  Webhook:   NOT CONFIGURED"
    echo "  Status:    UNAVAILABLE (set DISCORD_WEBHOOK_URL in ${ENV_FILE})"
  fi
  echo ""

  # Email
  echo "--- Email ---"
  echo "  From:      ${ADMIN_EMAIL}"
  echo "  CLI:       gws"
  if command -v gws &>/dev/null; then
    echo "  Status:    READY (gws CLI available)"
  else
    echo "  Status:    UNAVAILABLE (gws CLI not found)"
  fi
  echo ""

  # Summary
  local channels=0
  [ -z "${DISCORD_WEBHOOK_URL}" ] || channels=$((channels + 1))
  command -v gws &>/dev/null && channels=$((channels + 1))
  docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^overlord$' && channels=$((channels + 1))
  echo "Available channels: ${channels}/3"
}

# ── USAGE ────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
notification-hub — Multi-channel notifications with fallback

COMMANDS:
  notify.sh send <message> [--channel all|whatsapp|discord|email] [--to EMAIL]
      Send a notification. Default: WhatsApp -> Discord -> Email fallback chain.

  notify.sh whatsapp <message>
      Queue message via WhatsApp outbox (/tmp/wa-outbox.json)

  notify.sh discord <message>
      Send directly to Discord webhook

  notify.sh email <to> <subject> <message>
      Send email via gws CLI (Gmail API)

  notify.sh test
      Send a test message to all channels, report results

  notify.sh status
      Check which notification channels are available/configured

ENVIRONMENT:
  DISCORD_WEBHOOK_URL    Discord webhook URL (or set in /root/overlord/.env)

FALLBACK CHAIN (default):
  1. WhatsApp outbox (verify pickup within 15s)
  2. Discord webhook
  3. Email to Gil (overlord.gil.ai@gmail.com)

EXAMPLES:
  notify.sh send "Server restarted successfully"
  notify.sh send "Alert: disk 90% full" --channel discord
  notify.sh send "Build failed" --channel all
  notify.sh send "Report attached" --channel email --to "someone@example.com"
  notify.sh discord "Deploy complete"
  notify.sh email "someone@example.com" "Subject" "Body text"
  notify.sh test
  notify.sh status
USAGE
}

# ── MAIN ─────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  send)              cmd_send "$@" ;;
  whatsapp|wa)       cmd_whatsapp "$@" ;;
  discord|dc)        cmd_discord "$@" ;;
  email)             cmd_email "$@" ;;
  test)              cmd_test ;;
  status)            cmd_status ;;
  help|--help|-h)    usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: notify.sh help"
    exit 1
    ;;
esac
