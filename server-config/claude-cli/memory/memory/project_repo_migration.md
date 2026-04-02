---
name: GitHub Repo Migration to overlordforthew
description: All repos transferring from bluemele to overlordforthew — initiated 2026-04-01, pending acceptance
type: project
---

Repo migration from bluemele → overlordforthew initiated 2026-04-01. All 9 repos transferred via GitHub API, pending acceptance by overlordforthew account.

**Repos:** OnlyHulls, Elmo, NamiBarden, BeastMode, Lumina, ElSalvador, MasterCommander, SurfaBabe, Sandbox

**Why:** The `beast-mode-git` GitHub App in Coolify was misconfigured — OnlyHulls was assigned `source_id=2` (beast-mode-git app) which didn't have proper webhook delivery. Rather than fixing per-repo app access, Gil decided to centralize all repos under overlordforthew (Overlord's GitHub account).

**After acceptance, update:**
1. Git remotes on every project: `git remote set-url origin "https://overlordforthew:${GH_TOKEN}@github.com/overlordforthew/REPO.git"`
2. Coolify DB: `UPDATE applications SET git_repository = 'overlordforthew/REPO' WHERE git_repository = 'bluemele/REPO'`
3. Webhooks: create manual webhooks for each repo pointing to Coolify
4. CLAUDE.md files: update `bluemele/` references to `overlordforthew/`
5. GH_TOKEN in .env may need updating if it's bluemele-scoped

**How to apply:** Check transfer status with `gh api repos/overlordforthew/OnlyHulls` — if it returns the repo, transfers are complete. Then run the update steps above.
