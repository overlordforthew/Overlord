---
name: GitHub is overlordforthew
description: ALL repos are under overlordforthew on GitHub — bluemele is archived/dead. Never push to bluemele.
type: feedback
---

ALL Gil's repos are under **overlordforthew** on GitHub. bluemele is fully archived/legacy — never push there.

**Why:** Gil migrated everything to overlordforthew and has corrected this multiple times. bluemele repos are all archived.

**How to apply:** For ANY git push on ANY project:
1. `gh auth switch --user overlordforthew`
2. `TOKEN=$(gh auth token) && git remote set-url origin "https://overlordforthew:${TOKEN}@github.com/overlordforthew/REPO.git"`
3. `git push`

Do NOT use GH_TOKEN from /root/overlord/.env — that's bluemele's old token.

Repos on overlordforthew: Overlord, MasterCommander, NamiBarden, BeastMode, Lumina, OnlyHulls, SurfaBabe, Elmo, ElSalvador, hyperliquid-bot, OverlordWeb, Sandbox, shannon.
