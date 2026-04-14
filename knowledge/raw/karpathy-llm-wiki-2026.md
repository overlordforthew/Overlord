# LLM Wiki — Andrej Karpathy

Source: https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f
Date: 2026-04-04

A pattern for building personal knowledge bases using LLMs.

## The Core Idea

Most people's experience with LLMs and documents looks like RAG: you upload a collection of files, the LLM retrieves relevant chunks at query time, and generates an answer. This works, but the LLM is rediscovering knowledge from scratch on every question. There's no accumulation.

The idea here is different. Instead of just retrieving from raw documents at query time, the LLM incrementally builds and maintains a persistent wiki — a structured, interlinked collection of markdown files that sits between you and the raw sources. When you add a new source, the LLM doesn't just index it for later retrieval. It reads it, extracts the key information, and integrates it into the existing wiki — updating entity pages, revising topic summaries, noting where new data contradicts old claims, strengthening or challenging the evolving synthesis. The knowledge is compiled once and then kept current, not re-derived on every query.

The wiki is a persistent, compounding artifact. The cross-references are already there. The contradictions have already been flagged. The synthesis already reflects everything you've read.

You never (or rarely) write the wiki yourself — the LLM writes and maintains all of it. You're in charge of sourcing, exploration, and asking the right questions.

## Architecture — Three Layers

1. **Raw sources** — curated collection of source documents. Immutable. LLM reads but never modifies.
2. **The wiki** — LLM-generated markdown files. Summaries, entity pages, concept pages, comparisons. LLM owns this entirely.
3. **The schema** — CLAUDE.md / AGENTS.md. Tells the LLM how the wiki is structured, conventions, workflows.

## Operations

**Ingest:** Drop a new source, LLM processes it. Reads source, discusses takeaways, writes summary, updates index, updates entity/concept pages. A single source might touch 10-15 wiki pages.

**Query:** Ask questions against the wiki. LLM searches relevant pages, synthesizes answer with citations. Good answers can be filed back into the wiki as new pages.

**Lint:** Periodically health-check the wiki. Look for: contradictions, stale claims, orphan pages, missing concepts, missing cross-references, data gaps.

## Indexing and Logging

**index.md** — content-oriented catalog. Each page listed with link, summary, metadata. LLM reads index first to find relevant pages. Works at ~100 sources, ~hundreds of pages.

**log.md** — chronological append-only record. Ingests, queries, lint passes. Parseable with grep.

## Why This Works

The tedious part of maintaining a knowledge base is not the reading or thinking — it's the bookkeeping. LLMs don't get bored, don't forget to update a cross-reference, and can touch 15 files in one pass. The human's job is to curate sources, direct analysis, ask good questions. The LLM's job is everything else.

Related to Vannevar Bush's Memex (1945) — a personal, curated knowledge store with associative trails. Bush's vision was closer to this than what the web became: private, actively curated, connections as valuable as documents. The part he couldn't solve was who does the maintenance. The LLM handles that.
