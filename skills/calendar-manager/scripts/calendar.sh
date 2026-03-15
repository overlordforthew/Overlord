#!/bin/bash
# calendar-manager — Google Calendar management via gws CLI
# Usage: calendar.sh <command> [args...]
set -euo pipefail

TZ_OFFSET="-04:00"
TZ_NAME="America/Puerto_Rico"
CALENDAR_ID="primary"
WORK_START=9
WORK_END=18

# ── HELPERS ──────────────────────────────────────────────────────────────────

# Format ISO datetime to "10:00 AM" (12-hour)
format_time() {
  local dt="$1"
  TZ="$TZ_NAME" date -d "$dt" '+%-I:%M %p'
}

# Format ISO date to "Mar 15 (Saturday)"
format_date_header() {
  local dt="$1"
  TZ="$TZ_NAME" date -d "$dt" '+%b %-d (%A)'
}

# Get date string in YYYY-MM-DD for a relative day
relative_date() {
  TZ="$TZ_NAME" date -d "$1" '+%Y-%m-%d'
}

# Convert YYYY-MM-DD to ISO start/end of day in UTC for API queries
day_range_utc() {
  local d="$1"
  local start end
  start=$(TZ="$TZ_NAME" date -d "${d} 00:00:00" -u '+%Y-%m-%dT%H:%M:%SZ')
  end=$(TZ="$TZ_NAME" date -d "${d} 23:59:59" -u '+%Y-%m-%dT%H:%M:%SZ')
  echo "$start $end"
}

# Fetch events for a date range (UTC ISO strings)
fetch_events() {
  local time_min="$1" time_max="$2"
  gws calendar events list --params "{\"calendarId\":\"${CALENDAR_ID}\",\"timeMin\":\"${time_min}\",\"timeMax\":\"${time_max}\",\"singleEvents\":true,\"orderBy\":\"startTime\"}" 2>/dev/null
}

# Fetch events with a search query
fetch_events_query() {
  local time_min="$1" time_max="$2" query="$3"
  gws calendar events list --params "{\"calendarId\":\"${CALENDAR_ID}\",\"timeMin\":\"${time_min}\",\"timeMax\":\"${time_max}\",\"singleEvents\":true,\"orderBy\":\"startTime\",\"q\":\"${query}\"}" 2>/dev/null
}

# Render a list of events for one day from JSON
render_day_events() {
  local json="$1" target_date="$2"
  local header
  header=$(format_date_header "$target_date")
  echo "$header"

  local count
  count=$(echo "$json" | jq -r --arg d "$target_date" '
    [(.items // [])[] | select(
      ((.start.dateTime // "") | split("T")[0]) == $d or
      (.start.date // "") == $d
    )] | length
  ')

  if [ "$count" = "0" ]; then
    echo "  No events"
    return
  fi

  echo "$json" | jq -r --arg d "$target_date" '
    (.items // [])[] |
    select(
      ((.start.dateTime // "") | split("T")[0]) == $d or
      (.start.date // "") == $d
    ) |
    if .start.date and (.start.dateTime | not) then
      "  All day           \(.summary // "(No title)")"
    else
      "\(.start.dateTime)|\(.end.dateTime)|\(.summary // "(No title)")"
    end
  ' | while IFS= read -r line; do
    if [[ "$line" == "  All day"* ]]; then
      echo "$line"
    else
      local start_dt end_dt summary
      start_dt=$(echo "$line" | cut -d'|' -f1)
      end_dt=$(echo "$line" | cut -d'|' -f2)
      summary=$(echo "$line" | cut -d'|' -f3-)
      local start_fmt end_fmt
      start_fmt=$(format_time "$start_dt")
      end_fmt=$(format_time "$end_dt")
      printf "  %-8s - %-8s %s\n" "$start_fmt" "$end_fmt" "$summary"
    fi
  done
}

# Render events across multiple days from a single API response
render_events_multiday() {
  local json="$1" start_date="$2" num_days="$3"
  local i d
  for ((i = 0; i < num_days; i++)); do
    d=$(TZ="$TZ_NAME" date -d "${start_date} + ${i} days" '+%Y-%m-%d')
    render_day_events "$json" "$d"
    echo ""
  done
}

# ── COMMANDS ─────────────────────────────────────────────────────────────────

cmd_today() {
  local today
  today=$(relative_date "today")
  local range
  range=($(day_range_utc "$today"))
  local json
  json=$(fetch_events "${range[0]}" "${range[1]}")
  echo ""
  render_day_events "$json" "$today"
  echo ""
}

cmd_tomorrow() {
  local tomorrow
  tomorrow=$(relative_date "tomorrow")
  local range
  range=($(day_range_utc "$tomorrow"))
  local json
  json=$(fetch_events "${range[0]}" "${range[1]}")
  echo ""
  render_day_events "$json" "$tomorrow"
  echo ""
}

cmd_week() {
  local today
  today=$(relative_date "today")
  local end_date
  end_date=$(TZ="$TZ_NAME" date -d "${today} + 6 days" '+%Y-%m-%d')
  local start_utc end_utc
  start_utc=$(TZ="$TZ_NAME" date -d "${today} 00:00:00" -u '+%Y-%m-%dT%H:%M:%SZ')
  end_utc=$(TZ="$TZ_NAME" date -d "${end_date} 23:59:59" -u '+%Y-%m-%dT%H:%M:%SZ')
  local json
  json=$(fetch_events "$start_utc" "$end_utc")
  echo ""
  render_events_multiday "$json" "$today" 7
}

cmd_agenda() {
  local target_date="${1:?Usage: calendar.sh agenda <YYYY-MM-DD>}"
  # Validate date format
  if ! date -d "$target_date" &>/dev/null; then
    echo "ERROR: Invalid date: $target_date"
    exit 1
  fi
  local range
  range=($(day_range_utc "$target_date"))
  local json
  json=$(fetch_events "${range[0]}" "${range[1]}")
  echo ""
  render_day_events "$json" "$target_date"
  echo ""
}

cmd_create() {
  local title="${1:?Usage: calendar.sh create <title> <YYYY-MM-DD> <HH:MM> [duration_min]}"
  local event_date="${2:?Usage: calendar.sh create <title> <YYYY-MM-DD> <HH:MM> [duration_min]}"
  local event_time="${3:?Usage: calendar.sh create <title> <YYYY-MM-DD> <HH:MM> [duration_min]}"
  local duration="${4:-60}"

  # Validate date
  if ! date -d "$event_date" &>/dev/null; then
    echo "ERROR: Invalid date: $event_date"
    exit 1
  fi

  # Validate time format
  if ! [[ "$event_time" =~ ^[0-9]{1,2}:[0-9]{2}$ ]]; then
    echo "ERROR: Invalid time format. Use HH:MM (24-hour)"
    exit 1
  fi

  # Build ISO 8601 start datetime with AST offset
  local start_iso="${event_date}T${event_time}:00${TZ_OFFSET}"

  # Calculate end time
  local start_epoch
  start_epoch=$(TZ="$TZ_NAME" date -d "$start_iso" '+%s')
  local end_epoch=$((start_epoch + duration * 60))
  local end_iso
  end_iso=$(TZ="$TZ_NAME" date -d "@${end_epoch}" "+%Y-%m-%dT%H:%M:%S${TZ_OFFSET}")

  # Create the event
  local body
  body=$(jq -n \
    --arg title "$title" \
    --arg start "$start_iso" \
    --arg end "$end_iso" \
    --arg tz "$TZ_NAME" \
    '{
      summary: $title,
      start: { dateTime: $start, timeZone: $tz },
      end: { dateTime: $end, timeZone: $tz }
    }')

  local result
  result=$(gws calendar events insert --params "{\"calendarId\":\"${CALENDAR_ID}\"}" --json "$body" 2>/dev/null)

  local event_id
  event_id=$(echo "$result" | jq -r '.id // "unknown"')

  local start_fmt end_fmt date_fmt
  start_fmt=$(format_time "$start_iso")
  end_fmt=$(format_time "$end_iso")
  date_fmt=$(format_date_header "$event_date")

  echo ""
  echo "Event created!"
  echo "  Title:    $title"
  echo "  Date:     $date_fmt"
  echo "  Time:     $start_fmt - $end_fmt (${duration} min)"
  echo "  Event ID: $event_id"
  echo ""
}

cmd_delete() {
  local event_id="${1:?Usage: calendar.sh delete <event_id>}"

  # Fetch event details first
  local result
  result=$(gws calendar events get --params "{\"calendarId\":\"${CALENDAR_ID}\",\"eventId\":\"${event_id}\"}" 2>/dev/null)

  local summary start_dt end_dt
  summary=$(echo "$result" | jq -r '.summary // "(No title)"')
  start_dt=$(echo "$result" | jq -r '.start.dateTime // .start.date // "unknown"')
  end_dt=$(echo "$result" | jq -r '.end.dateTime // .end.date // "unknown"')

  if [ "$summary" = "null" ] || [ -z "$summary" ]; then
    echo "ERROR: Event not found: $event_id"
    exit 1
  fi

  echo ""
  echo "About to delete:"
  echo "  Title: $summary"
  if [[ "$start_dt" == *"T"* ]]; then
    local start_fmt end_fmt
    start_fmt=$(format_time "$start_dt")
    end_fmt=$(format_time "$end_dt")
    local date_part
    date_part=$(echo "$start_dt" | cut -dT -f1)
    echo "  Date:  $(format_date_header "$date_part")"
    echo "  Time:  $start_fmt - $end_fmt"
  else
    echo "  Date:  $start_dt (all day)"
  fi
  echo ""

  read -rp "Delete this event? (y/N): " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    gws calendar events delete --params "{\"calendarId\":\"${CALENDAR_ID}\",\"eventId\":\"${event_id}\"}" >/dev/null 2>&1
    echo "Event deleted."
  else
    echo "Cancelled."
  fi
  echo ""
}

cmd_find() {
  local query="${1:?Usage: calendar.sh find <query>}"

  # Search 6 months back and 6 months forward
  local now_date
  now_date=$(relative_date "today")
  local start_utc end_utc
  start_utc=$(TZ="$TZ_NAME" date -d "${now_date} - 180 days" -u '+%Y-%m-%dT%H:%M:%SZ')
  end_utc=$(TZ="$TZ_NAME" date -d "${now_date} + 180 days" -u '+%Y-%m-%dT%H:%M:%SZ')

  local json
  json=$(fetch_events_query "$start_utc" "$end_utc" "$query")

  local count
  count=$(echo "$json" | jq '.items | length')

  echo ""
  echo "Search: \"$query\" ($count results)"
  echo ""

  if [ "$count" = "0" ]; then
    echo "  No events found."
    echo ""
    return
  fi

  echo "$json" | jq -r '
    .items[] |
    if .start.date and (.start.dateTime | not) then
      "\(.start.date)|all-day|all-day|\(.summary // "(No title)")|\(.id)"
    else
      "\(.start.dateTime)|\(.end.dateTime)|timed|\(.summary // "(No title)")|\(.id)"
    end
  ' | while IFS='|' read -r start_dt end_dt kind summary eid; do
    if [ "$kind" = "all-day" ]; then
      local date_fmt
      date_fmt=$(format_date_header "$start_dt")
      printf "  %-22s All day        %-30s [%s]\n" "$date_fmt" "$summary" "$eid"
    else
      local date_part start_fmt end_fmt date_hdr
      date_part=$(echo "$start_dt" | cut -dT -f1)
      date_hdr=$(format_date_header "$date_part")
      start_fmt=$(format_time "$start_dt")
      end_fmt=$(format_time "$end_dt")
      printf "  %-22s %s - %-8s %-30s [%s]\n" "$date_hdr" "$start_fmt" "$end_fmt" "$summary" "$eid"
    fi
  done
  echo ""
}

cmd_free() {
  local target_date="${1:?Usage: calendar.sh free <YYYY-MM-DD>}"

  # Validate date
  if ! date -d "$target_date" &>/dev/null; then
    echo "ERROR: Invalid date: $target_date"
    exit 1
  fi

  local range
  range=($(day_range_utc "$target_date"))
  local json
  json=$(fetch_events "${range[0]}" "${range[1]}")

  local date_hdr
  date_hdr=$(format_date_header "$target_date")

  echo ""
  echo "Free time on $date_hdr"
  echo "Working hours: $(printf '%d' $WORK_START):00 AM - $(printf '%d' $((WORK_END - 12))):00 PM"
  echo ""

  # Collect busy intervals as epoch pairs
  local busy_file
  busy_file=$(mktemp)

  echo "$json" | jq -r --arg d "$target_date" '
    .items[] |
    select(
      ((.start.dateTime // "") | split("T")[0]) == $d
    ) |
    "\(.start.dateTime)|\(.end.dateTime)|\(.summary // "(No title)")"
  ' | while IFS='|' read -r start_dt end_dt summary; do
    local s_epoch e_epoch
    s_epoch=$(TZ="$TZ_NAME" date -d "$start_dt" '+%s')
    e_epoch=$(TZ="$TZ_NAME" date -d "$end_dt" '+%s')
    echo "${s_epoch}|${e_epoch}|${summary}" >> "$busy_file"
  done

  # Working hours as epoch
  local work_start_epoch work_end_epoch
  work_start_epoch=$(TZ="$TZ_NAME" date -d "${target_date} ${WORK_START}:00:00" '+%s')
  work_end_epoch=$(TZ="$TZ_NAME" date -d "${target_date} ${WORK_END}:00:00" '+%s')

  # Check for all-day events
  local has_allday
  has_allday=$(echo "$json" | jq -r --arg d "$target_date" '
    [.items[] | select(.start.date == $d and (.start.dateTime | not))] | length
  ')

  # Show scheduled events
  local event_count
  event_count=$(wc -l < "$busy_file")
  if [ "$event_count" -gt 0 ] || [ "$has_allday" -gt 0 ]; then
    echo "Scheduled:"
    if [ "$has_allday" -gt 0 ]; then
      echo "$json" | jq -r --arg d "$target_date" '
        .items[] | select(.start.date == $d and (.start.dateTime | not)) |
        "  All day           \(.summary // "(No title)")"
      '
    fi
    sort -t'|' -k1 -n "$busy_file" | while IFS='|' read -r s_epoch e_epoch summary; do
      local s_fmt e_fmt
      s_fmt=$(TZ="$TZ_NAME" date -d "@${s_epoch}" '+%-I:%M %p')
      e_fmt=$(TZ="$TZ_NAME" date -d "@${e_epoch}" '+%-I:%M %p')
      printf "  %-8s - %-8s %s\n" "$s_fmt" "$e_fmt" "$summary"
    done
    echo ""
  fi

  # Find free slots
  echo "Available:"

  # Sort busy intervals by start time
  local sorted_busy
  sorted_busy=$(sort -t'|' -k1 -n "$busy_file")

  local cursor="$work_start_epoch"
  local found_free=0

  if [ "$event_count" -gt 0 ]; then
    echo "$sorted_busy" | while IFS='|' read -r s_epoch e_epoch summary; do
      # Clamp to working hours
      [ "$s_epoch" -lt "$work_start_epoch" ] && s_epoch="$work_start_epoch"
      [ "$e_epoch" -gt "$work_end_epoch" ] && e_epoch="$work_end_epoch"

      if [ "$cursor" -lt "$s_epoch" ]; then
        local free_start free_end dur_min
        free_start=$(TZ="$TZ_NAME" date -d "@${cursor}" '+%-I:%M %p')
        free_end=$(TZ="$TZ_NAME" date -d "@${s_epoch}" '+%-I:%M %p')
        dur_min=$(( (s_epoch - cursor) / 60 ))
        printf "  %-8s - %-8s (%d min)\n" "$free_start" "$free_end" "$dur_min"
        found_free=1
      fi
      # Move cursor past this event
      [ "$e_epoch" -gt "$cursor" ] && cursor="$e_epoch"
    done

    # Read final cursor from re-processing (subshell issue workaround)
    local final_cursor="$work_start_epoch"
    while IFS='|' read -r s_epoch e_epoch summary; do
      [ "$s_epoch" -lt "$work_start_epoch" ] && s_epoch="$work_start_epoch"
      [ "$e_epoch" -gt "$work_end_epoch" ] && e_epoch="$work_end_epoch"
      [ "$e_epoch" -gt "$final_cursor" ] && final_cursor="$e_epoch"
    done <<< "$sorted_busy"

    if [ "$final_cursor" -lt "$work_end_epoch" ]; then
      local free_start free_end dur_min
      free_start=$(TZ="$TZ_NAME" date -d "@${final_cursor}" '+%-I:%M %p')
      free_end=$(TZ="$TZ_NAME" date -d "@${work_end_epoch}" '+%-I:%M %p')
      dur_min=$(( (work_end_epoch - final_cursor) / 60 ))
      printf "  %-8s - %-8s (%d min)\n" "$free_start" "$free_end" "$dur_min"
    fi
  else
    local free_start free_end dur_min
    free_start=$(TZ="$TZ_NAME" date -d "@${work_start_epoch}" '+%-I:%M %p')
    free_end=$(TZ="$TZ_NAME" date -d "@${work_end_epoch}" '+%-I:%M %p')
    dur_min=$(( (work_end_epoch - work_start_epoch) / 60 ))
    printf "  %-8s - %-8s (%d min) — entire day free\n" "$free_start" "$free_end" "$dur_min"
  fi

  rm -f "$busy_file"
  echo ""
}

# ── USAGE ────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
calendar-manager — Google Calendar management via gws CLI

VIEW EVENTS:
  calendar.sh today                              Show today's events
  calendar.sh tomorrow                           Show tomorrow's events
  calendar.sh week                               Show this week's events (7 days)
  calendar.sh agenda <YYYY-MM-DD>                Show events for a specific date

CREATE/DELETE:
  calendar.sh create <title> <date> <time> [min] Create event (date: YYYY-MM-DD, time: HH:MM 24h)
                                                 Duration defaults to 60 min
  calendar.sh delete <event_id>                  Delete event (confirms first)

SEARCH:
  calendar.sh find <query>                       Search events by title (6 months +/-)

AVAILABILITY:
  calendar.sh free <YYYY-MM-DD>                  Show free time slots (9 AM - 6 PM)

EXAMPLES:
  calendar.sh today
  calendar.sh create "Team standup" 2026-03-16 10:00
  calendar.sh create "Quick sync" 2026-03-16 14:00 30
  calendar.sh find "standup"
  calendar.sh free 2026-03-16
  calendar.sh delete abc123def456
USAGE
}

# ── MAIN ─────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  today)      cmd_today ;;
  tomorrow)   cmd_tomorrow ;;
  week)       cmd_week ;;
  agenda)     cmd_agenda "$@" ;;
  create)     cmd_create "$@" ;;
  delete)     cmd_delete "$@" ;;
  find|search) cmd_find "$@" ;;
  free)       cmd_free "$@" ;;
  help|--help|-h) usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: calendar.sh help"
    exit 1
    ;;
esac
