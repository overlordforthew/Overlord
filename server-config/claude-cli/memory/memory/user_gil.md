---
name: Gil's Working Style
description: Gil is a hands-on developer who evaluates tools by practical fit and expects immediate action, not proposals
type: user
---

Gil is the sole developer/operator of this stack. Technical depth across Node.js, Docker, Linux, trading, and marine systems.

**Communication style:** Terse, action-oriented. Sends research/analysis as context (often from Overlord WhatsApp), then gives one-line directives. "Put it on ElmoServer, containerize it, send the API" — not "what do you think about deploying this?"

**Tool evaluation:** Judges tools by practical utility: hardware requirements, zero-shot capability (no training overhead), integration effort, whether it runs on his hardware. Compares alternatives concisely (e.g., "Prophet needs per-series fitting, Chronos is heavier, Moirai wants GPU — TimesFM hits the sweet spot").

**Expectations:**
- Execute immediately, don't propose unless uncertain about direction
- Containerize everything — if it runs, it runs in Docker
- API-first: services expose HTTP endpoints for other projects to consume
- Verify end-to-end before reporting done
- Cross-project awareness: one service often feeds multiple projects (TimesFM → MC + HL bot)
