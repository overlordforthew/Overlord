# AIRI Harvest Report
## Repository: moeru-ai/airi (34.1k stars, MIT License)

### Analysis Summary
- 2973 files, 100 tools, 33 prompts
- Primary language: TypeScript (Vue.js, Electron, Capacitor)
- Architecture: Monorepo with plugin system, multi-transport event bus, modular AI companion

---

## TOP 5 EXTRACTABLE PATTERNS

### 1. PLUGIN HOST ARCHITECTURE (High Relevance)
**What it does**: Full plugin lifecycle management — discovery, authentication, compatibility negotiation, configuration, and hot-reload. Plugins can be local (in-memory) or remote (WebSocket). Uses XState state machines for lifecycle management and Eventa for transport-agnostic RPC.

**Key files**:
- `packages/plugin-sdk/src/plugin-host/core.ts` (1123 lines — the core)
- `packages/plugin-sdk/src/plugin/define.ts` (definePlugin pattern)
- `packages/plugin-sdk/src/plugin/shared.ts` (Plugin interface)
- `packages/plugin-sdk/src/channels/` (transport layer)

**How it maps to Overlord**: Our skill system is currently flat files + a registry. AIRI's plugin-host shows how to add lifecycle management (init → configure → ready → running → error), dependency resolution between plugins, and hot-reload without restarting the container. The `definePlugin(name, version, setup)` pattern is elegant and could standardize how we define skills.

**Steal-worthy**: The compatibility negotiation protocol (version checking before loading) and the transport abstraction (same API surface for local and remote plugins).

---

### 2. PROMPT COMPOSITION UTILITIES (High Relevance)
**What it does**: HTML-inspired prompt building with `div()`, `span()`, `vif()`, `vChoice()`, `ul()` functions. Composes prompts from reusable blocks, handles conditional inclusion, whitespace normalization.

**Key files**:
- `services/telegram-bot/src/prompts/utils.ts` (47 lines — compact!)
- `services/telegram-bot/src/prompts/index.ts` (template loading via Velin)

**How it maps to Overlord**: We build prompts as raw strings in our skills. These utilities would let us compose complex prompts from reusable sections with conditional logic. The `vif(condition, include, else)` pattern is particularly useful for skills that need different prompts based on context.

**Steal-worthy**: The entire utils.ts file — it's 47 lines and immediately useful. Also the Velin templating approach for loading prompt templates from markdown files.

---

### 3. ACTION NORMALIZATION PATTERN (High Relevance)
**What it does**: When LLMs return JSON actions, they often use inconsistent field names (chatId vs chat_id vs recipient_id). AIRI's `imagineAnAction()` normalizes these with alias maps, parameter flattening, and fallback inference.

**Key files**:
- `services/telegram-bot/src/llm/actions.ts` (183 lines)

**How it maps to Overlord**: When Overlord processes tool calls or parses LLM responses, we could use the same normalization pattern. The action alias map (`read_messages` → `read_unread_messages`) and field alias resolution are production-hardened patterns for dealing with LLM inconsistency.

**Steal-worthy**: The action normalization block (lines 107-171) — handles wrapped parameters, action name aliases, field name aliases, and smart fallback inference.

---

### 4. MULTI-PROVIDER ABSTRACTION (Medium Relevance)
**What it does**: Unified provider system supporting 20+ LLM/TTS/STT backends. Each provider has capabilities (listModels, listVoices), configuration, and instance management. Built on xsAI for OpenAI-compatible APIs.

**Key files**:
- `packages/stage-ui/src/stores/providers/` (provider registry)
- `packages/stage-ui/src/stores/modules/consciousness.ts` (LLM provider)
- `packages/stage-ui/src/stores/modules/speech.ts` (TTS provider)
- `packages/stage-ui/src/stores/modules/hearing.ts` (STT provider)
- `.agents/skills/xsai/SKILL.md` (xsAI patterns)

**How it maps to Overlord**: We currently hardcode Claude. If we ever want to add Ollama for local tasks or switch between models dynamically, this provider abstraction pattern is the way to do it. The capability-based detection (does this provider support model listing? voice listing?) is smart.

**Steal-worthy**: The provider metadata + capabilities pattern. Not the Vue-specific implementation, but the concept of `getProviderMetadata(id).capabilities.listModels`.

---

### 5. EVENTA TRANSPORT-AGNOSTIC RPC (Medium Relevance)
**What it does**: Define typed events once, use them across any transport — WebSocket, EventEmitter, Web Workers, Electron IPC, BroadcastChannel. Supports unary RPC (invoke), server-streaming, client-streaming, and bidirectional streaming.

**Key files**:
- `.agents/skills/eventa/SKILL.md` (complete API reference)
- `apps/stage-tamagotchi/src/shared/` (contract definitions)

**How it maps to Overlord**: If we ever need inter-container communication (e.g., Overlord ↔ autoresearch on Elmo), Eventa's pattern of defining typed events centrally and swapping transports is cleaner than raw WebSocket handlers. The `defineInvokeEventa<Response, Request>()` pattern gives type safety across process boundaries.

**Steal-worthy**: The pattern, not the library. Defining RPC contracts as typed event definitions that work identically regardless of transport.

---

## ARCHITECTURAL IDEAS WORTH STEALING

### Module System (consciousness/speech/hearing)
AIRI separates AI capabilities into discrete "modules" — consciousness (thinking), speech (TTS), hearing (STT). Each module has its own store, provider selection, and configuration. This modular decomposition maps well to how Overlord could structure its capabilities (reasoning, memory, voice, vision).

### Skill Files as Documentation
AIRI's `.agents/skills/` directory contains comprehensive skill files that serve as both documentation AND context for AI coding agents. Each skill has references, usage rules, and anti-patterns. This is exactly what we're building, and their format is mature — worth studying for improving our SKILL.md template.

### OpenTelemetry Tracing
The bot services use OpenTelemetry spans for every LLM call, action generation, and response parsing. This gives full observability into AI decision-making. We could add similar tracing to Overlord's skill executions.

### Velin Prompt Templates
Markdown-based prompt templates loaded at runtime with variable interpolation. Separates prompt content from code, making prompts easier to iterate on without redeploying.

---

## SKILLS GENERATED (2026-03-17)
1. **agent-cognitive-architecture** — 3-layer brain, action registry, context management, attention handler, action normalization
2. **agent-event-loop** — Queue/schedule/dispatch pattern with safety guardrails, abort control, context trimming
