# WhatsApp & Baileys Patterns

## Connection Health
- Baileys uses WebSocket to WhatsApp servers. Connections drop regularly — this is normal.
- **Status 440 "Stream Errored (conflict)":** Another device/session connected with the same credentials. Common during container rebuilds. Auto-resolves on reconnect.
- **MAC errors:** Session state corruption. If persistent, delete `auth/` directory and re-link via QR code.
- **Inbound silence watchdog:** Triggers after 5 min of no messages. Forces reconnect to ensure the socket is live, not just "connected."

## Message Handling Quirks
- **Group LIDs:** In groups, WhatsApp sends LID (Linked ID) instead of phone numbers. Must maintain LID→phone reverse lookup table. LIDs can change — keep the mapping updated.
- **Message batching:** Users send rapid-fire messages. The 800ms batch window collects them before responding. Too short = multiple responses; too long = feels slow.
- **Read receipts:** Sending read receipts (blue ticks) signals the bot is processing. Important for UX.
- **Media downloads:** Media messages must be downloaded within ~30 seconds or the URL expires. Download immediately on receipt, then process.

## Response Delivery
- **Message splitting:** WhatsApp truncates at ~4000 chars. Split long responses with `(1/N)` prefix.
- **Media send failures:** During reconnects, media sends fail silently. Use retry with reconnect-aware delay (check socket state before retry, not just blind sleep).
- **Typing indicators:** Send typing indicator before processing. Users see "typing..." which signals the bot received their message.

## Session Management
- Each chat gets a persistent Claude CLI session (session ID stored per chatJid). This gives continuity but stale sessions can pollute context.
- **Session guard:** Kills orphaned Claude CLI processes that exceed time limits. Prevents runaway sessions from consuming all memory.
- **Session rotation:** Create a new session when context is clearly stale or user explicitly asks to start fresh (`/clear`).
