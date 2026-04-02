---
name: Business User Lens for Product Work
description: Gil evaluates product changes from buyer/seller perspective (Garry Tan / YC thinking), not technical perspective
type: feedback
---

When working on product features, think from the business user's perspective — what makes buyers happy, what makes sellers happy.

**Why:** Gil explicitly said "Let's always think about things from a Garry Tan/Business Use Case point of view. What the buyer wants, what a seller wants. This is all we are doing is making happy buyers and sellers." He evaluates features by whether they serve users, not by technical elegance.

**How to apply:**
- Before coding: ask "does this help a buyer find/buy a boat?" or "does this help a seller get leads/sell?"
- Data quality issues → add to integrity checker script so bad data doesn't recur
- Visual/UX issues → fix in code directly
- For OnlyHulls specifically: use the data integrity script (`scraper/check_integrity.py`) as the growing rulebook for what constitutes good data
- When Codex or other tools audit the site, filter findings through "does this matter to a buyer or seller?" before acting
