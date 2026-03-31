---
name: Coolify API access pattern
description: Coolify API is blocked via public URL — must use localhost:8000 with token from overlord .env
type: feedback
---

Coolify API at `coolify.namibarden.com` returns "Forbidden" for all requests (Tailscale-restricted).

Use `localhost:8000` instead:
```
COOLIFY_API_TOKEN=$(grep '^COOLIFY_API_TOKEN=' /root/overlord/.env | cut -d= -f2-)
curl -s -X POST "http://localhost:8000/api/v1/applications/{uuid}/restart" \
  -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
  -H "Content-Type: application/json"
```

**Why:** Discovered 2026-03-30 after multiple failed attempts via public URL. The `.env` file has angle brackets that break `source`, so extract the token with `grep | cut`.

**How to apply:** Always use localhost:8000 for Coolify API calls. Never source the full overlord .env (angle brackets in RESEND_FROM_EMAIL break bash). Extract individual vars with grep.
