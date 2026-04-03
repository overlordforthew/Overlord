---
name: GitHub Account Migration
description: Repos moved from bluemele to overlordforthew — all project remotes should use overlordforthew
type: reference
---

As of 2026-04-01, all project repos were copied from `bluemele` to `overlordforthew` GitHub account.

- **Active repos**: `overlordforthew/<project>` — push here
- **bluemele repos**: archived, read-only
- **overlordforthew token**: available via `gh auth token --user overlordforthew`
- **bluemele GH_TOKEN** in overlord/.env does NOT have push access to overlordforthew repos
- When setting remotes: `git remote set-url origin "https://overlordforthew:${OFW_TOKEN}@github.com/overlordforthew/REPO.git"`

**How to apply:** Always use `overlordforthew` for git push operations on project repos. Never unarchive bluemele repos.
