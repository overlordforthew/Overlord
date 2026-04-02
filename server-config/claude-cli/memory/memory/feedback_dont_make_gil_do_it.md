---
name: Don't Ask Gil To Do It
description: Gil expects Overlord to use all available tools (Chrome, APIs, DB) rather than giving him manual instructions
type: feedback
---

Don't tell Gil to do something manually when you have the tools to do it yourself.

**Why:** When told "you need to go to the Coolify UI to create a GitHub App," Gil responded: "No, you do it, you have the tools, don't make me do it." He was right — Chrome DevTools MCP can navigate any web UI. Similarly for GitHub settings, Coolify admin, etc.

**How to apply:** Before saying "you'll need to..." — check if Chrome DevTools, curl, the DB, or any other tool can accomplish it. The only legitimate blockers are: passwords you don't have, 2FA prompts, or actions that require Gil's personal device. Even then, try first. Gil has a local Claude Code plugin on his browser that can handle things requiring his auth — give it instructions only as a last resort.
