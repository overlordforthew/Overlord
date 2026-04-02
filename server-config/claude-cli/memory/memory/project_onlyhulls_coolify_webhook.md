---
name: OnlyHulls Coolify Webhook Fix
description: OnlyHulls auto-deploy was broken — fixed with manual GitHub webhook on 2026-04-01
type: project
---

OnlyHulls Coolify auto-deploy was silently broken. Root cause: assigned to `beast-mode-git` GitHub App (source_id=2) which wasn't delivering webhooks for OnlyHulls pushes.

**Fix applied 2026-04-01:**
- Created manual GitHub webhook (id=603976848) on bluemele/OnlyHulls
- URL: `https://coolify.namibarden.com/webhooks/source/github/events/manual`
- Secret stored in Coolify DB: `manual_webhook_secret_github` for app uuid `qkggs84cs88o0gww4wc80gwo`
- Verified: webhook delivers HTTP 200, Coolify queues ApplicationDeploymentJob

**Build failure discovered:** Coolify builds after commit 31dd8b4 were failing because `useSearchParams()` in sign-up page lacked a Suspense boundary (Next.js 15 requirement). Fixed in commit 7d5cf9f.

**Manual deploy workaround used:** When Coolify was stuck, built image locally with `docker build -t qkggs84cs88o0gww4wc80gwo:latest .` and swapped container with `--network coolify --network-alias onlyhulls-app`. Traefik routes to `http://onlyhulls-app:80`.

**How to apply:** If OnlyHulls deploy seems stuck, check: 1) webhook deliveries on GitHub, 2) `docker exec coolify php artisan check:deployment-queue`, 3) Coolify logs for ApplicationDeploymentJob. The manual deploy path works as a fallback.
