# Agent Cognitive Architecture

Patterns for building multi-layer AI agent systems with structured thinking, action registries, context management, and attention control. Extracted from moeru-ai/airi (34k stars).

## When to Use
- Building or extending AI agents that need structured decision-making
- Adding tool/action registration to an agent system
- Implementing conversation memory management
- Adding attention/interruption handling for multi-channel bots

## Core Patterns

### 1. Three-Layer Brain
Separate agent cognition into three layers that operate at different speeds:

| Layer | Purpose | Speed | Example |
|-------|---------|-------|---------|
| Conscious | Deliberation, planning via LLM | Slow (1-5s) | "Should I respond to this?" |
| Perception | Event collection + signal inference | Medium (10-100ms) | "User mentioned my name" |
| Reflex | Reactive behaviors, no LLM | Fast (<10ms) | "Acknowledge receipt immediately" |

The conscious layer calls the LLM. Perception enriches raw events into signals. Reflex handles immediate responses that don't need reasoning.

### 2. Action Registry
Centralized registry of all available actions/tools with schema validation:

```typescript
class ActionRegistry {
  private actions: Action[] = []

  registerAction(action: Action): void {
    this.actions.push(action)
  }

  async performAction(step: { tool: string, params: any }): Promise<unknown> {
    const action = this.actions.find(a => a.name === step.tool)
    if (!action) throw new Error(`Unknown action: ${step.tool}`)
    const parsedParams = action.schema.parse(step.params || {})
    return action.perform(parsedParams)
  }

  getAvailableActions(): Action[] {
    return [...this.actions]
  }
}
```

Each action defines: name, description, Zod schema for params, and a perform() function.

### 3. Auto-Generated Tool Documentation
Introspect Zod schemas to auto-generate compact tool descriptions for system prompts:

```
action_name(param1, param2) | Short description | param1:string, param2:number(min=1,max=100)
```

Key techniques:
- Abbreviate common words (automatically->auto, coordinates->coords)
- Extract type names and constraints from Zod definitions
- Generate one-line signatures, not verbose JSON Schema
- Hot-reload prompt templates from disk in dev mode

### 4. Context Management
Task-scoped conversation blocks with auto-summarization:

```typescript
// Start a task context
agent.enterContext("deploying-namibarden")
// ... conversation turns within this context ...
// Summarize and archive when done
agent.exitContext("Deployed NamiBarden v2.3 — fixed SSL cert and restarted container")
```

Benefits:
- Prevents O(turns^2) context growth
- Archived contexts become searchable summaries
- New conversations start clean but can reference past context summaries
- No LLM call needed for summarization — the exit summary is deterministic

### 5. Attention Handler
Adaptive response system for multi-channel bots:

```
Decision tree (in order):
1. Private message? -> Always respond
2. Mentioned or replied-to? -> Always respond
3. Trigger words matched? -> Respond
4. Cooldown elapsed? -> Check rate
5. Rate > random() ? -> Respond
6. Otherwise -> Skip

Rate adjustment:
- Mention: +100% to rate
- Trigger word: +50% to rate
- Time decay: rate *= (1 - minutesSinceLastInteraction * decayRate)
- Bounds: [responseRateMin, responseRateMax]
```

Config params: initialResponseRate, decayRatePerMinute, cooldownMs, triggerWords[], ignoreWords[]

### 6. Action Normalization
Handle LLM inconsistency when generating action payloads:

```typescript
// Alias maps for action names
const actionAliases = {
  'read_messages': 'read_unread_messages',
  'send_msg': 'send_message',
}

// Alias maps for parameter fields
const fieldAliases = {
  'chatId': 'channel_id',
  'chat_id': 'channel_id',
  'recipient_id': 'channel_id',
}

// Unwrap nested params (LLMs sometimes wrap: {action: "x", params: {params: {actual}}})
function normalizeParams(raw: any): any {
  if (raw?.params?.params) return raw.params.params
  if (raw?.params) return raw.params
  return raw
}
```

## Anti-Patterns
- Don't put all logic in the conscious layer — reflexes should bypass LLM
- Don't truncate conversation history — summarize and archive instead
- Don't hardcode tool descriptions — generate from schemas
- Don't respond to every message in group chats — use attention decay

## Source
- Repository: github.com/moeru-ai/airi
- Key files: services/minecraft/src/cognitive/, services/telegram-bot/src/bots/telegram/agent/
- License: MIT
