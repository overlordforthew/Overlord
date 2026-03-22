---
name: google-cloud
description: Manage and use Google Cloud APIs — Gemini, Veo, Imagen, Workspace (Gmail, Drive, Sheets, Calendar), YouTube. Covers auth, enabled services, and usage patterns.
argument-hint: <action> [args]
allowed-tools: Bash, Read, Write, Edit, Grep, Glob, Agent, WebFetch
---

## Google Cloud API Skill

Operational skill for ALL Google APIs. When invoked, execute the requested action — don't just reference docs.

### Quick Reference — Scripts

| Script | What it does |
|---|---|
| `bash scripts/gcloud-api.sh list-apis` | List all enabled APIs on the project |
| `bash scripts/gcloud-api.sh enable <api>` | Enable a Google API |
| `bash scripts/gcloud-api.sh disable <api>` | Disable a Google API |
| `bash scripts/gcloud-api.sh discover [filter]` | Search all available Google APIs |
| `bash scripts/gcloud-api.sh call <url> [method] [body]` | Call ANY Google API with OAuth |
| `bash scripts/gcloud-api.sh call-key <url>` | Call any API with API key |
| `bash scripts/gcloud-api.sh token` | Get a fresh OAuth access token |
| `bash scripts/gemini.sh ask "prompt"` | Quick Gemini text generation |
| `bash scripts/gemini.sh models` | List all Gemini/Veo/Imagen models |
| `bash scripts/gemini.sh image "prompt"` | Generate image with Imagen 4.0 |
| `bash scripts/gemini.sh embed "text"` | Get text embedding |
| `bash scripts/gemini.sh count "text"` | Count tokens |
| `bash scripts/api-status.sh` | Full API health check |

All scripts are at `/root/.claude/skills/google-cloud/scripts/`.

### Projects

| Project ID | Purpose | Auth |
|---|---|---|
| `overlord-488220` | Main GCP project, OAuth, Workspace + Cloud APIs | OAuth via `gws` |
| `961837060087` | API key project, Gemini/Veo/Imagen | `GOOGLE_API_KEY` in `/root/overlord/.env` |

### How to Do Anything

#### 1. Call a Workspace API (Gmail, Drive, Sheets, Calendar, Docs, Tasks)
```bash
# Use gws CLI directly — handles auth automatically
gws <service> <resource> <method> --params '<JSON>' [--json '<body>']

# Discover method params
gws schema <service.resource.method>
```

**Services:** drive, sheets, gmail, calendar, docs, slides, tasks, people, chat, classroom, forms, keep, meet, events, admin-reports, workflow

**Common operations:**
```bash
# Gmail
gws gmail users messages list --params '{"userId": "me", "maxResults": 5}'
gws gmail users messages get --params '{"userId": "me", "id": "MSG_ID", "format": "full"}'

# Drive
gws drive files list --params '{"pageSize": 10}'
gws drive files get --params '{"fileId": "ID", "alt": "media"}' --output ./file.pdf
gws drive files create --params '{"uploadType": "multipart"}' --json '{"name":"test.txt","mimeType":"text/plain"}' --upload ./test.txt

# Sheets
gws sheets spreadsheets values get --params '{"spreadsheetId": "ID", "range": "Sheet1!A1:D10"}'
gws sheets spreadsheets values update --params '{"spreadsheetId": "ID", "range": "Sheet1!A1", "valueInputOption": "USER_ENTERED"}' --json '{"values": [["a","b"]]}'

# Calendar
gws calendar events list --params '{"calendarId": "primary", "maxResults": 10, "timeMin": "2026-03-21T00:00:00Z"}'
gws calendar events insert --params '{"calendarId": "primary"}' --json '{"summary": "Meeting", "start": {"dateTime": "2026-03-22T10:00:00-04:00"}, "end": {"dateTime": "2026-03-22T11:00:00-04:00"}}'

# Tasks
gws tasks tasklists list
gws tasks tasks list --params '{"tasklist": "TASKLIST_ID"}'

# Docs
gws docs documents get --params '{"documentId": "DOC_ID"}'

# Pagination
gws drive files list --params '{"pageSize": 100}' --page-all --page-limit 5

# Output formats: --format json|table|yaml|csv
```

#### 2. Call a Gemini/AI API (text, images, video, embeddings)
```bash
# Quick operations via helper
bash /root/.claude/skills/google-cloud/scripts/gemini.sh ask "prompt" [--model gemini-2.5-pro]
bash /root/.claude/skills/google-cloud/scripts/gemini.sh image "prompt" [output_path]
bash /root/.claude/skills/google-cloud/scripts/gemini.sh embed "text"
```

```python
# Full Python SDK for complex operations
from google import genai
from google.genai import types
import os

client = genai.Client(api_key=os.environ["GOOGLE_API_KEY"])

# Text generation
response = client.models.generate_content(model="gemini-2.5-flash", contents="prompt")
print(response.text)

# Image generation (Imagen 4.0)
response = client.models.generate_images(
    model="imagen-4.0-generate-001",
    prompt="prompt",
    config=types.GenerateImagesConfig(number_of_images=1)
)
response.generated_images[0].image.save("output.png")

# Streaming
for chunk in client.models.generate_content_stream(model="gemini-2.5-flash", contents="prompt"):
    print(chunk.text, end="")
```

Always `source /root/overlord/.env` before using the API key.

#### 3. Call ANY Google REST API (OAuth-authenticated)
```bash
# Get a token and call any endpoint
bash /root/.claude/skills/google-cloud/scripts/gcloud-api.sh call \
  "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true"

# POST with body
bash /root/.claude/skills/google-cloud/scripts/gcloud-api.sh call \
  "https://www.googleapis.com/some/api" POST '{"key": "value"}'

# Or get token manually
TOKEN=$(bash /root/.claude/skills/google-cloud/scripts/gcloud-api.sh token)
curl -s -H "Authorization: Bearer $TOKEN" "https://any-google-api.googleapis.com/..."
```

#### 4. Manage APIs (enable/disable/list)
```bash
# List what's enabled
bash /root/.claude/skills/google-cloud/scripts/gcloud-api.sh list-apis

# Enable an API
bash /root/.claude/skills/google-cloud/scripts/gcloud-api.sh enable vision.googleapis.com
bash /root/.claude/skills/google-cloud/scripts/gcloud-api.sh enable youtube.googleapis.com

# Disable
bash /root/.claude/skills/google-cloud/scripts/gcloud-api.sh disable vision.googleapis.com

# Search available APIs
bash /root/.claude/skills/google-cloud/scripts/gcloud-api.sh discover youtube
bash /root/.claude/skills/google-cloud/scripts/gcloud-api.sh discover translate
```

**Requires `cloud-platform` scope.** If you get a scope error, Gil needs to: `! gws auth login --full`

#### 5. Discover API Methods
```bash
# Workspace API schemas (exact params for any method)
gws schema drive.files.list
gws schema gmail.users.messages.send
gws schema sheets.spreadsheets.values.update

# Google API Discovery (all Google APIs)
bash /root/.claude/skills/google-cloud/scripts/gcloud-api.sh discover [filter]
```

#### 6. Video Generation
Use the dedicated `/veo` skill:
```bash
source /root/overlord/.env && GOOGLE_API_KEY="$GOOGLE_API_KEY" \
  python3 /root/.claude/skills/veo/generate.py "prompt" [--model veo-3.0-generate-001]
```

### Authentication

| Method | What it covers | How to get a token |
|---|---|---|
| API Key | Gemini, Veo, Imagen | `source /root/overlord/.env` → `$GOOGLE_API_KEY` |
| OAuth (gws) | Workspace + Cloud APIs | `gws` handles automatically, or `gcloud-api.sh token` |

**OAuth scopes currently authorized:** drive, sheets, gmail.modify, calendar, documents, presentations, tasks, openid, email

**If you need cloud-platform scope** (for API management): `! gws auth login --full`

**If OAuth breaks:**
1. `gws auth status` — check what's wrong
2. `tail -10 /var/log/gws-keepalive.log` — check keepalive history
3. Gil runs: `! gws auth login` (or `--full` for Cloud APIs)

### Automated Maintenance

| Cron | Schedule | Purpose |
|---|---|---|
| `gws-keepalive.sh` | Every 4h | Pings Drive API to keep token alive |
| `google-api-monitor.sh` | Daily 5:30am | Full health check, logs to `/var/log/google-api-monitor.log` |

App is published to **production** — refresh tokens are permanent (no 7-day expiry).

### Key Files

| File | Purpose |
|---|---|
| `/root/overlord/.env` | `GOOGLE_API_KEY` |
| `~/.config/gws/` | OAuth credentials (encrypted) |
| `/root/.claude/skills/google-cloud/scripts/` | All helper scripts |
| `/root/.claude/skills/veo/` | Video generation skill |
| `/var/log/gws-keepalive.log` | Token keepalive log |
| `/var/log/google-api-monitor.log` | Daily API health log |
