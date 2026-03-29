# Agent Event Loop

Production patterns for building safe, bounded AI agent loops with queue management, action dispatch, and context trimming. Extracted from moeru-ai/airi satori-bot (34k stars).

## When to Use
- Building autonomous agent loops that process events and generate actions
- Adding safety guardrails to prevent infinite loops or context explosion
- Implementing multi-channel event processing with priority handling
- Designing interruptible agent workflows

## Core Pattern: Queue -> Schedule -> Dispatch

```
Events arrive -> Queue (dedup + buffer)
                    |
              Scheduler (per iteration):
                1. Trim action history to MAX_ACTIONS_IN_CONTEXT
                2. Fetch recent DB messages for context
                3. Call LLM: imagineAnAction(messages, actions, events)
                4. If no action -> break
                5. Dispatch action -> record result
                6. If shouldContinue -> delay -> next iteration
                    |
              Safety bounds:
                - MAX_LOOP_ITERATIONS (hard cap)
                - AbortController per iteration (interruptible)
                - LOOP_CONTINUE_DELAY_MS between iterations
                - MAX_UNREAD_EVENTS cap
```

## Reference Constants

| Constant | Typical Value | Purpose |
|----------|--------------|---------|
| MAX_LOOP_ITERATIONS | 5 | Hard cap per event batch |
| LOOP_CONTINUE_DELAY_MS | 1000 | Pause between iterations |
| MAX_ACTIONS_IN_CONTEXT | 20 | Context window management |
| ACTIONS_KEEP_ON_TRIM | 5 | Keep N most recent on trim |
| PERIODIC_LOOP_INTERVAL_MS | 30000 | Background check interval |
| MAX_UNREAD_EVENTS | 50 | Event queue cap |
| MAX_RECENT_INTERACTED_CHANNELS | 10 | Channel tracking limit |

## Implementation Details

### Action History Trimming
Don't just truncate — keep the most recent N actions and drop the middle:
```typescript
function trimActions(actions: Action[], max: number, keepRecent: number): Action[] {
  if (actions.length <= max) return actions
  return actions.slice(-keepRecent)
}
```

### Interruptible Execution
Each iteration creates its own AbortController. New incoming events abort the current iteration:
```typescript
if (chatCtx.currentAbortController) {
  chatCtx.currentAbortController.abort()  // Cancel current LLM call
}
const controller = new AbortController()
chatCtx.currentAbortController = controller

// Pass to LLM call
const action = await imagineAnAction(controller, messages, actions, events)
```

### Dynamic Context Injection
Don't rely solely on in-memory history. Fetch recent messages from DB each iteration:
```typescript
const dbMessages = await getRecentMessages(channelId, 10)
const llmMessages = dbMessages.map(m => ({
  role: m.userId === selfId ? 'assistant' : 'user',
  content: m.content,
}))
```

### Dispatch Result Contract
Each dispatched action returns whether to continue the loop:
```typescript
interface DispatchResult {
  shouldContinue: boolean  // true = loop again, false = done
  result?: any             // action output
}
```

### Error Handling
- AbortError -> log and stop (expected interruption)
- Other errors -> log with context and stop
- Always clean up AbortController in finally block
- Never retry automatically in the same loop — let the next event trigger a fresh loop

## Periodic Background Loop
Besides event-driven loops, run a periodic check for unprocessed events:
```
setInterval(() => {
  for (channel of recentChannels) {
    if (hasUnreadEvents(channel)) {
      handleLoopStep(ctx, client, chatCtx)
    }
  }
}, PERIODIC_LOOP_INTERVAL_MS)
```

## Anti-Patterns
- No MAX_LOOP_ITERATIONS -> infinite loops when LLM keeps generating actions
- No AbortController -> can't interrupt slow LLM calls for urgent events
- Unbounded action history -> context window overflow, degraded LLM performance
- Synchronous dispatch -> blocks other channels while one processes
- Retry loops inside the event loop -> amplifies errors instead of backing off

## Integration with Cognitive Architecture
The event loop is the "heartbeat" of the conscious layer:
- Perception layer feeds events into the queue
- Scheduler calls the conscious layer (LLM) for planning
- Dispatcher executes actions through the action registry
- Reflex layer handles immediate responses outside the loop

## Source
- Repository: github.com/moeru-ai/airi
- Key files: services/satori-bot/src/core/loop/scheduler.ts, dispatcher.ts
- License: MIT
