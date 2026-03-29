# Skill: langchain-memory

## Description
Intelligent context compression using `ConversationSummaryBufferMemory`. Replaces hard message cutoffs with automatic summarization of older messages while keeping the most recent turns verbatim. Prevents context window overflow without losing important earlier context.

## Type
Library (npm package `langchain`)

## Configuration
- Package: `langchain` + `@langchain/openai` (or `@langchain/anthropic`)
- Install: `npm install langchain @langchain/openai`

## Usage
```typescript
import { ConversationSummaryBufferMemory } from "langchain/memory";
import { ChatOpenAI } from "@langchain/openai";

const memory = new ConversationSummaryBufferMemory({
  llm: new ChatOpenAI({ modelName: "gpt-4o-mini" }),
  maxTokenLimit: 2000,        // keep recent messages up to this token count
  returnMessages: true,       // return as message objects, not a string
});

// Save turns
await memory.saveContext(
  { input: "What's the plan for today?" },
  { output: "Check Overlord logs, then deploy NamiBarden." }
);

// Load for next LLM call — older turns auto-summarized
const { history } = await memory.loadMemoryVariables({});
// history = [SystemMessage("Summary: ..."), HumanMessage("..."), AIMessage("...")]
```

## When to Use
- Managing long-running conversation threads that exceed context limits
- Compressing older messages while preserving verbatim recent context
- Any agent loop where message history grows unbounded
- Replacing manual `messages.slice(-N)` cutoffs with intelligent summarization

## Requirements
- Node.js 18+
- An LLM API key (OpenAI or Anthropic) — summarization requires an LLM call
- No GPU, no external service beyond the LLM API
