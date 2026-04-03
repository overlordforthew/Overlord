# Model Routing Decisions

## Router Evolution
1. **v1:** Single model (Opus). Simple but expensive for trivial messages.
2. **v2 (current):** Three modes — Alpha/Beta/Charlie. Opus classifies complexity and routes.
3. **Lesson learned:** Routing overhead (the Opus classification call) sometimes costs more than just using Opus for everything. Alpha mode exists because of this.

## What Worked
- **Opus for admin:** Always. Gil's messages are contextually dense and often require tool use.
- **Auto-escalation:** When a cheaper model struggles (low confidence, short/confused response), auto-escalate to Opus. Catches quality drops early.
- **Task-type classification:** Simple regex patterns catch obvious cases (greetings → simple, code blocks → complex). Saves the LLM classification call for ambiguous messages.

## What Didn't Work
- **Charlie mode (free models):** Quality too inconsistent. Gemma, GLM, and Nemotron all have failure modes that produce gibberish. Only useful for idle study sessions where quality doesn't matter.
- **Aggressive cost optimization:** Routing everything possible to Haiku saved money but tanked response quality. Users noticed immediately.
- **Session sharing across models:** Tried sharing Claude CLI sessions between Opus and Sonnet. Context mismatch caused confusion. Each model needs its own session.

## Current Model Registry
- **Opus (claude-opus-4-6):** Admin, complex tasks, thinking partner mode. Default for Alpha.
- **Sonnet (claude-sonnet-4-6):** Power user tasks, code review. Good balance of speed/quality.
- **Haiku (claude-haiku-4-5):** Quick lookups, simple translations. Fast but shallow.
- **Free models:** StepFun, GLM, Nemotron, Gemma via OpenRouter. Unreliable. Use only for study/benchmarks.
- **Gemini Flash:** Free, decent for simple tasks. Used as backup when OpenRouter is down.

## Timeout Lessons
- Opus with tool use routinely takes 3-5 minutes for complex tasks. Original 2-minute timeout caused chronic failures.
- Current timeouts: simple 4min, chat 7min, max 10min. These accommodate tool use without being wasteful.
- Free models need shorter timeouts (30s) because they either respond fast or not at all.
