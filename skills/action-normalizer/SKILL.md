---
name: action-normalizer
description: Normalize LLM-generated JSON actions — handle inconsistent field names, wrapped parameters, action aliases, and smart fallback inference. Use when parsing LLM tool calls or structured JSON responses that may have inconsistent formatting.
trigger: action parsing, LLM response normalization, tool call parsing, JSON action normalization
---

# Action Normalizer

Pattern for handling inconsistent LLM JSON output. Extracted from moeru-ai/airi's production Telegram bot (34k stars).

## The Problem

LLMs return inconsistent JSON. The same action might come back as:
- `{ "action": "read_messages", "chat_id": "123" }`
- `{ "action": "Read_unread_messages", "parameters": { "chatId": "123" } }`
- `{ "action": "get_unread_messages", "recipient_id": "123" }`

## The Pattern

### 1. Parameter Flattening
Unwrap nested `parameters` objects to top level:

```javascript
if (raw.parameters && typeof raw.parameters === 'object') {
  for (const [key, value] of Object.entries(raw.parameters)) {
    if (!(key in raw)) raw[key] = value;
  }
  delete raw.parameters;
}
```

### 2. Action Name Aliases
Map common LLM variations to canonical action names:

```javascript
const actionAliases = {
  read_messages: 'read_unread_messages',
  get_unread_messages: 'read_unread_messages',
  check_messages: 'read_unread_messages',
  reply_message: 'send_message',
  reply_to_a_message: 'send_message',
};

if (typeof raw.action === 'string' && actionAliases[raw.action]) {
  raw.action = actionAliases[raw.action];
}
```

### 3. Field Name Aliases
Normalize inconsistent field names to canonical ones:

```javascript
if (!raw.chatId) {
  raw.chatId = raw.recipient_id ?? raw.group_id ?? raw.chat_id
    ?? raw.user_id ?? raw.conversation_id ?? raw.id;
  // Clean up aliases
  delete raw.recipient_id;
  delete raw.chat_id;
}

if (!raw.content) {
  raw.content = raw.message ?? raw.text ?? raw.chat_message;
  delete raw.message;
  delete raw.text;
}
```

### 4. Smart Fallback Inference
When required fields are missing, infer from context:

```javascript
// If only one chat has unread messages, that's probably the target
if (!raw.chatId) {
  const activeChatIds = Object.keys(state.chats).filter(
    k => state.chats[k]?.unread > 0,
  );
  if (activeChatIds.length === 1) {
    raw.chatId = activeChatIds[0];
  }
}
```

### 5. JSON Cleanup
Strip markdown code fences from LLM responses before parsing:

```javascript
responseText = res.text
  .replace(/^```json\s*\n/, '')
  .replace(/\n```$/, '')
  .replace(/^```\s*\n/, '')
  .replace(/\n```$/, '')
  .trim();
```

Use `best-effort-json-parser` for partial/malformed JSON.

## Usage in Overlord

When parsing LLM responses for skill execution, tool calls, or any structured output:

1. Strip code fences
2. Parse with best-effort JSON parser
3. Flatten nested parameters
4. Apply action name aliases
5. Apply field name aliases
6. Infer missing required fields from context
7. Validate the normalized result

## When to Use
- Parsing LLM tool call responses
- Normalizing structured output from different models
- Building robust action handlers that tolerate LLM inconsistency
- Any skill that expects JSON from an LLM and needs reliability
