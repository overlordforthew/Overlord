# Skill: mem0

## Description
Automatic fact extraction and semantic memory from conversations. Parses messages to extract discrete facts, stores them in a vector + SQLite backend, and retrieves relevant memories by semantic meaning rather than keyword match.

## Type
Library (npm package `mem0ai`)

## Configuration
- Package: `mem0ai`
- Storage: in-memory vector store + SQLite (no external service required)
- Install: `npm install mem0ai`

## Usage
```typescript
import { Memory } from "mem0ai";

const memory = new Memory();

// Store facts from a conversation turn
await memory.add("Gil prefers concise WhatsApp replies in plain text", { user_id: "gil" });

// Retrieve semantically relevant memories
const results = await memory.search("communication preferences", { user_id: "gil" });
// results: [{ memory: "Gil prefers concise...", score: 0.91 }]

// Get all memories for a user
const all = await memory.getAll({ user_id: "gil" });
```

## When to Use
- Processing conversations to automatically extract and persist facts about a user
- Retrieving relevant context before responding (semantic recall, not just recent messages)
- Building a persistent user model that survives session resets
- Reducing repetition — user shouldn't need to re-explain their preferences each session

## Requirements
- Node.js 18+
- No GPU, no external service — runs fully in-process
- SQLite for persistence (bundled via better-sqlite3)
