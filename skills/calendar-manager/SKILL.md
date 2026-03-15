---
name: calendar-manager
version: 1.0.0
description: "Google Calendar management via gws CLI — view, create, delete, search events and check availability."
---

# Calendar Manager

Manage Gil's Google Calendar from the command line using the authenticated gws CLI.

## Quick Reference

| Command | What it does |
|---------|-------------|
| `calendar.sh today` | Show today's events |
| `calendar.sh tomorrow` | Show tomorrow's events |
| `calendar.sh week` | Show 7-day event overview |
| `calendar.sh agenda <YYYY-MM-DD>` | Show events for a specific date |
| `calendar.sh create <title> <date> <time> [min]` | Create an event (default 60 min) |
| `calendar.sh delete <event_id>` | Delete an event (confirms first) |
| `calendar.sh find <query>` | Search events by title (+/- 6 months) |
| `calendar.sh free <YYYY-MM-DD>` | Show free time slots (9 AM - 6 PM) |

## Configuration

- **Calendar:** primary (overlord.gil.ai@gmail.com)
- **Timezone:** America/Puerto_Rico (AST, UTC-4)
- **Working hours:** 9:00 AM - 6:00 PM (for `free` command)
- **Auth:** gws CLI, OAuth credentials at `~/.config/gws/`

## Usage

Scripts are at:
- Host: `/root/overlord/skills/calendar-manager/scripts/calendar.sh`
- Container: `/app/skills/calendar-manager/scripts/calendar.sh`

### Common Workflows

**Morning check:**
```bash
calendar.sh today
```

**Plan tomorrow:**
```bash
calendar.sh tomorrow
calendar.sh free 2026-03-16
```

**Schedule a meeting:**
```bash
calendar.sh create "Client call" 2026-03-16 14:00
calendar.sh create "Quick sync" 2026-03-16 10:00 30
```

**Find an event to reschedule:**
```bash
calendar.sh find "standup"
```

**Weekly overview:**
```bash
calendar.sh week
```

## Dependencies

- `gws` — Google Workspace CLI (authenticated)
- `jq` — JSON processing
- `date` — GNU date (for time calculations)

## When to Use

- Checking today's or upcoming schedule
- Creating calendar events from WhatsApp or CLI
- Finding free time slots for scheduling
- Searching past/future events by keyword
- Deleting cancelled events
