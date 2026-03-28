---
name: twitter
description: Monitor X/Twitter accounts and get WhatsApp digests of new posts. Use when user says "twitter", "x monitor", "tweet watch", "check tweets", or wants to track/manage X account watches.
argument-hint: <command> [args] — Commands: list, status, add <handle>, remove <handle>, check [handle], peek <handle>
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
metadata:
  author: Gil Barden / Overlord
  version: "2026-03-27"
---

# X/Twitter Monitor

Monitor X/Twitter accounts via Chrome CDP (logged-in session at localhost:9223). New posts are sent to Gil's WhatsApp via Overlord's API. Scheduled checks run at **9 AM and 5 PM AST** via host crontab.

## Script

All operations go through one script on the **host** (not inside the Overlord container):

```
cd /root/overlord && node scripts/x-monitor.mjs <command> [args]
```

## Commands

| Command | Description |
|---------|-------------|
| `list` | Show all watched accounts with last check time |
| `status` | Detailed state: tracked tweet IDs, Chrome CDP reachability |
| `add <handle> [Display Name]` | Add an account to the watch list |
| `remove <handle>` | Remove an account and clear its state |
| `check` | Check all accounts now (same as cron does) — sends WhatsApp if new posts |
| `check <handle>` | Check a single account |
| `peek <handle>` | Fetch and display latest tweets without updating state or sending alerts |

Handles accept `@` prefix or bare: `@intocryptoverse` and `intocryptoverse` both work.

## Examples

```bash
# List what's being watched
cd /root/overlord && node scripts/x-monitor.mjs list

# Add a new account
cd /root/overlord && node scripts/x-monitor.mjs add elonmusk "Elon Musk"

# Preview someone's recent tweets (no state change)
cd /root/overlord && node scripts/x-monitor.mjs peek intocryptoverse

# Force a check now (sends WhatsApp if new tweets found)
cd /root/overlord && node scripts/x-monitor.mjs check

# Check just one account
cd /root/overlord && node scripts/x-monitor.mjs check intocryptoverse

# Remove an account
cd /root/overlord && node scripts/x-monitor.mjs remove intocryptoverse

# Show full status
cd /root/overlord && node scripts/x-monitor.mjs status
```

## Files

| File | Purpose |
|------|---------|
| `/root/overlord/scripts/x-monitor.mjs` | Main script (runs on host) |
| `/root/overlord/data/x-watch-config.json` | Watched accounts list |
| `/root/overlord/data/x-watch-state.json` | Last-seen tweet IDs per account |
| `/root/overlord/logs/x-monitor.log` | Cron run logs |

## How It Works

1. Connects to headful Chrome at `localhost:9223` via CDP (already logged into X)
2. Opens a new tab, navigates to the profile page
3. Extracts tweets via DOM selectors (`[data-testid="tweet"]`)
4. Compares tweet IDs against stored state
5. If new tweets found (and not first run), formats a digest and sends via Overlord's `/api/send` endpoint to WhatsApp
6. Updates state file with latest tweet IDs

## Cron Schedule

Host crontab entry (already configured):
```
0 13,21 * * * cd /root/overlord && /usr/bin/node scripts/x-monitor.mjs >> logs/x-monitor.log 2>&1
```
This runs at 1 PM and 9 PM UTC = **9 AM and 5 PM AST**.

To change the schedule, edit the host crontab: `crontab -e`

## Troubleshooting

- **Chrome CDP not reachable**: Check Chrome is running (`ss -tlnp | grep 9223`). It must be the headful Chrome with CDP on port 9223.
- **No tweets extracted**: Twitter may have changed DOM structure. Check `peek` output. Selectors are in `fetchTweets()` in x-monitor.mjs.
- **WhatsApp not sending**: Verify Overlord is running (`docker ps | grep overlord`) and API is up (`curl http://127.0.0.1:3001/health`).
- **Lock file stuck**: If script won't run due to stale lock, clear it: `echo > /root/overlord/data/x-monitor.lock`
