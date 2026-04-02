---
name: Intelligence Over Speed
description: Gil prioritizes smart, capable responses over fast ones — never optimize for response time at the cost of quality
type: feedback
---

Gil explicitly does not care about response speed. He cares about the bot being smart and capable.

**Why:** When presented with response time optimization (103s avg, 5 timeouts), Gil said "I don't care about speed, I care about it being smart, capable." This is a strong, clear preference.

**How to apply:** Never suggest streaming partial answers, model downgrades (Sonnet/Haiku for speed), or context reduction to improve latency. Always use Opus with max effort. If a response takes 5 minutes but is thorough, that's preferred over a 30-second shallow answer. Don't flag slow responses as problems unless they're actual timeouts/failures.
