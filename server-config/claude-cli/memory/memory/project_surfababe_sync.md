---
name: SurfaBabe Site Replication
description: Task to replicate www.surfababe.com exactly to surfababe.namibarden.com — started 2026-03-27
type: project
---

Gil wants www.surfababe.com (the production domain) replicated exactly to surfababe.namibarden.com (the Hetzner-hosted version).

**Why:** The two sites have drifted — differences need to be identified and the namibarden version needs to match the www version precisely.

**How to apply:** Compare both sites visually and structurally, note all differences, then update the project at `/root/projects/SurfaBabe/` to match. Deploy method: `docker compose up -d --build` or GitHub webhook auto-deploy.

**Status as of 2026-03-27:** Task started but not completed. Initial agents launched to browse both sites and explore the project code.
