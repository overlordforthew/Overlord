---
name: Intelligence Systems Overhaul (2026-04-01)
description: Major overhaul of Overlord's learning/memory systems — categories fixed, thresholds lowered, error paths wired, cortex removed
type: project
---

Overhauled Overlord's intelligence systems on 2026-04-01 to fix coasting/underutilization.

**What changed:**
- Memory curator now derives categories from episodic tags (was setting `category: ''`). Backfilled 234 existing blank entries.
- Evolution engine: broadened correction/preference regex from 10→24 patterns, lowered consolidation threshold from >=3 to >=1
- Meta-learning synthesis thresholds lowered: friction 20→3, timeout 3→1, API error 5→2, added slow_response insight
- Wired logRegression, recordGap, logFriction into error-watcher.js (container crashes, 5xx spikes) and index.js (deploy failures, API errors)
- Bootstrapped capability-gaps.json for idle-study skill_practice mode
- Deleted cortex.js (462 lines dead code, zero imports, superseded by pulse.js)

**Why:** Learning systems were architecturally sound but operationally disconnected. Study sessions found "no gaps," evolution found "no signals," half the memory DB was uncategorized. The systems were running but not actually learning.

**How to apply:** Monitor these systems over the next week. Check `mem stats` for category distribution, review data/meta-learning/synthesis/ for daily insights, and verify capability-gaps.json is being populated by error events. If learning is still too quiet, further loosen signal detection or add more error path hooks.
