---
name: show-comparative-evidence
description: User wants to see side-by-side test results before committing to a design choice.
type: feedback
---

When proposing a design with multiple options, run comparative tests and show results in a table before asking the user to choose.

**Why:** User explicitly asked for head-to-head tests of Haiku vs Gemini engines before deciding on defaults. Did not accept theoretical arguments alone.

**How to apply:** For any architectural choice with measurable tradeoffs (model selection, tool choice, approach A vs B), build a quick test, run both options on the same input, and present results in a comparison table. Lead with data, not opinion.
