---
name: browse
description: Fetch and digest web pages using multiple browser engines. Lightpanda (fast, 4x Chrome speed) for scraping/digesting, Chrome DevTools MCP for full rendering/testing. Use when user says "browse", "read page", "digest url", "fetch site", "get content from", or wants to compare browser engines.
argument-hint: <url> [--engine lightpanda|chrome|auto] [--html|--links|--json|--eval "<js>"]
allowed-tools:
  - Bash
  - Read
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__take_snapshot
  - mcp__chrome-devtools__take_screenshot
  - mcp__chrome-devtools__evaluate_script
  - mcp__chrome-devtools__list_network_requests
  - mcp__chrome-devtools__list_console_messages
compatibility: Requires Lightpanda container running (docker-compose in /root/overlord) and/or Chrome DevTools MCP.
metadata:
  author: Gil Barden / Overlord
  version: "2026-03-14"
---

# Browse

Multi-engine browser tool for fetching, digesting, and inspecting web pages.

## Engines

| Engine | When to Use |
|--------|------------|
| **Lightpanda** (default) | Fast page digesting, text extraction, link scraping. ~4x faster than Chrome. |
| **Chrome** (DevTools MCP) | Full JS rendering, screenshots, forms, Lighthouse, SPA sites. |
| **auto** | Tries Lightpanda first, falls back to Chrome. |

## Instructions

Given a URL from `$ARGUMENTS` or the user:

### Default: Digest via Lightpanda (fast)

```bash
node /root/overlord/skills/browse/browse.js "$URL"
```

Returns clean text content. Add `--json` for structured output, `--links` for link extraction, `--html` for raw HTML.

### If the site needs full JS rendering (SPA, React, Next.js)

Use Chrome DevTools MCP instead:

```
navigate_page(url="$URL", type="url")
take_snapshot()
```

### If the user wants to compare engines

Run both and show the difference:

```bash
node /root/overlord/skills/browse/browse.js "$URL" --engine lightpanda --json
node /root/overlord/skills/browse/browse.js "$URL" --engine chrome --json
```

### If the user wants JS evaluation

```bash
node /root/overlord/skills/browse/browse.js "$URL" --eval "document.querySelectorAll('a').length"
```

### Check engine status

```bash
node /root/overlord/skills/browse/browse.js --engines
```

## Decision Matrix

| Need | Use |
|------|-----|
| Read article/page content | Lightpanda (`browse.js`) |
| Extract links from a page | Lightpanda (`--links`) |
| Test site functionality | Chrome (`/test-site`) |
| Screenshot a page | Chrome (`take_screenshot`) |
| JS-heavy SPA (React, Next) | Chrome (DevTools MCP) |
| Run JS on a page | Either (`--eval` or `evaluate_script`) |
| Anti-bot / Cloudflare sites | Scrapling skill |
| Speed benchmark | Both engines, compare times |

## Output

Present results cleanly:
- For digest: show title, engine used, then the clean text
- For links: show title, link count, then the table
- For comparison: side-by-side summary (engine, time, content length, title match)
