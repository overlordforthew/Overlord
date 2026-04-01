---
name: ElmoServer as scraping fallback
description: When Hetzner IP is blocked by sites, route requests through ElmoServer (100.89.16.27) or Gil's laptop
type: feedback
---

When scraping is blocked on Hetzner (503, Cloudflare, IP ban), use ElmoServer as a proxy:
- `ssh root@100.89.16.27 "curl -sS -L 'URL' -o /tmp/output.html"`
- `scp root@100.89.16.27:/tmp/output.html /tmp/output.html`

**Why:** TheYachtMarket blocked Hetzner's IP after a 5K bulk scrape (2026-03-31). ElmoServer at 100.89.16.27 worked immediately. Gil confirmed this is the expected fallback path.

**How to apply:** Before switching to mirror sites or giving up on a blocked scrape, try ElmoServer first. If ElmoServer is also blocked, Gil offered his local laptop as a third option (write a script for him to run).

For ongoing TYM scraping: the scraper should be modified to run from ElmoServer, or use an SSH tunnel/proxy through it.
