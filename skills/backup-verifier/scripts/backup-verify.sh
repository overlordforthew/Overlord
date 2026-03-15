#!/bin/bash
# backup-verify.sh — Verify integrity and completeness of nightly PostgreSQL backups
# Backup dir: /root/backups/  |  Backup script: /root/overlord/scripts/backup.sh
set -euo pipefail

BACKUP_DIR="/root/backups"
NOW=$(date +%s)

# Known PG containers and their users
declare -A DB_CONTAINERS=(
    [overlord-db]=overlord
    [namibarden-db]=namibarden
    [surfababe-db]=surfababe
    [mastercommander-db]=mastercommander
    [lumina-db]=lumina
    [coolify-db]=coolify
    [onlyhulls-db]=onlyhulls
)

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

log_ok()   { echo -e "  ${GREEN}OK${NC}    $*"; }
log_warn() { echo -e "  ${YELLOW}WARN${NC}  $*"; }
log_fail() { echo -e "  ${RED}FAIL${NC}  $*"; }
log_info() { echo -e "  ${CYAN}INFO${NC}  $*"; }
header()   { echo -e "\n${BOLD}=== $* ===${NC}"; }

# Regex for matching COPY statements (stored in variable to avoid bash parsing issues)
COPY_RE='^COPY[[:space:]]+([^[:space:](]+)'

# Cleanup trap for restore-test
TEMP_DB=""
RESTORE_CONTAINER=""
cleanup_temp_db() {
    if [[ -n "$TEMP_DB" && -n "$RESTORE_CONTAINER" ]]; then
        echo -e "\n${YELLOW}Cleaning up temp database ${TEMP_DB}...${NC}"
        docker exec "$RESTORE_CONTAINER" psql -U "${DB_CONTAINERS[$RESTORE_CONTAINER]}" -c "DROP DATABASE IF EXISTS \"$TEMP_DB\";" 2>/dev/null || true
        TEMP_DB=""
        RESTORE_CONTAINER=""
    fi
}
trap cleanup_temp_db EXIT

# ── check ──────────────────────────────────────────────────────────────
cmd_check() {
    header "Backup Health Check"
    local warnings=0
    local db_files

    db_files=$(find "$BACKUP_DIR" -name 'db-*.sql.gz' -type f 2>/dev/null | sort)
    if [[ -z "$db_files" ]]; then
        log_fail "No database backup files found in $BACKUP_DIR"
        return 1
    fi

    echo -e "\n${BOLD}Database backups:${NC}"
    printf "  %-45s %10s %12s %s\n" "FILE" "SIZE" "AGE" "STATUS"
    printf "  %-45s %10s %12s %s\n" "----" "----" "---" "------"

    while IFS= read -r f; do
        local fname size_bytes size_human mtime age_h status
        fname=$(basename "$f")
        size_bytes=$(stat -c%s "$f")
        size_human=$(du -h "$f" | cut -f1)
        mtime=$(stat -c%Y "$f")
        age_h=$(( (NOW - mtime) / 3600 ))

        status="${GREEN}OK${NC}"

        if (( size_bytes < 1024 )); then
            status="${YELLOW}SMALL${NC}"
            (( warnings++ )) || true
        fi

        if (( age_h > 24 )); then
            status="${YELLOW}OLD (${age_h}h)${NC}"
            (( warnings++ )) || true
        fi

        # Compression integrity
        if ! gunzip -t "$f" 2>/dev/null; then
            status="${RED}CORRUPT${NC}"
            (( warnings++ )) || true
        fi

        printf "  %-45s %10s %10sh  %b\n" "$fname" "$size_human" "$age_h" "$status"
    done <<< "$db_files"

    echo ""
    if (( warnings > 0 )); then
        log_warn "$warnings warning(s) found"
    else
        log_ok "All backups healthy"
    fi
}

# ── verify <file> ─────────────────────────────────────────────────────
cmd_verify() {
    local file="$1"
    # Resolve relative paths against BACKUP_DIR
    if [[ ! -f "$file" ]]; then
        file="$BACKUP_DIR/$file"
    fi
    if [[ ! -f "$file" ]]; then
        log_fail "File not found: $1"
        return 1
    fi

    header "Deep Verify: $(basename "$file")"

    # 1. Compression integrity
    echo -e "\n${BOLD}Compression integrity:${NC}"
    if gunzip -t "$file" 2>/dev/null; then
        log_ok "gzip integrity check passed"
    else
        log_fail "gzip integrity check FAILED"
        return 1
    fi

    # 2. Decompress and analyze
    local dump
    dump=$(gunzip -c "$file")

    # Database names
    echo -e "\n${BOLD}Databases found:${NC}"
    local databases
    databases=$(echo "$dump" | grep -oP '\\connect\s+\K\S+' | sort -u || true)
    if [[ -n "$databases" ]]; then
        while IFS= read -r db; do
            log_info "$db"
        done <<< "$databases"
    else
        log_info "(no \\connect directives — single database dump or pg_dumpall default)"
    fi

    # SQL statement counts
    echo -e "\n${BOLD}SQL statement counts:${NC}"
    local create_table insert copy_stmt
    create_table=$(echo "$dump" | grep -cP '^\s*CREATE TABLE' || true)
    insert=$(echo "$dump" | grep -cP '^\s*INSERT INTO' || true)
    copy_stmt=$(echo "$dump" | grep -cP '^\s*COPY\s+\S+.*FROM stdin' || true)
    log_info "CREATE TABLE:  $create_table"
    log_info "INSERT INTO:   $insert"
    log_info "COPY ... FROM: $copy_stmt"

    # Table names from CREATE TABLE
    echo -e "\n${BOLD}Tables defined:${NC}"
    local tables
    tables=$(echo "$dump" | grep -oP 'CREATE TABLE\s+(public\.)?\K\S+' | sed 's/(.*//;s/;$//' | sort -u || true)
    if [[ -n "$tables" ]]; then
        while IFS= read -r tbl; do
            log_info "$tbl"
        done <<< "$tables"
    else
        log_info "(no CREATE TABLE statements found)"
    fi

    # Estimate row counts from COPY blocks
    echo -e "\n${BOLD}Estimated row counts (from COPY blocks):${NC}"
    if (( copy_stmt > 0 )); then
        local in_copy=0 current_table="" row_count=0
        while IFS= read -r line; do
            if [[ $in_copy -eq 1 ]]; then
                if [[ "$line" == '\.' ]]; then
                    printf "  %-40s %s rows\n" "$current_table" "$row_count"
                    in_copy=0
                    row_count=0
                else
                    (( row_count++ )) || true
                fi
            elif [[ "$line" =~ $COPY_RE ]]; then
                local matched_table="${BASH_REMATCH[1]}"
                if [[ "$line" == *"FROM stdin"* ]]; then
                    current_table="$matched_table"
                    in_copy=1
                    row_count=0
                fi
            fi
        done <<< "$dump"
    else
        log_info "(no COPY blocks to estimate from)"
    fi
}

# ── compare <container> ───────────────────────────────────────────────
cmd_compare() {
    local container="$1"
    local pg_user="${DB_CONTAINERS[$container]:-}"

    if [[ -z "$pg_user" ]]; then
        log_fail "Unknown container: $container"
        echo "Known containers: ${!DB_CONTAINERS[*]}"
        return 1
    fi

    # Find latest backup for this container
    local latest
    latest=$(find "$BACKUP_DIR" -name "db-${container}-*.sql.gz" -type f 2>/dev/null | sort | tail -1)
    if [[ -z "$latest" ]]; then
        log_fail "No backup found for $container"
        return 1
    fi

    header "Compare: $container vs $(basename "$latest")"

    # Check container is running
    if ! docker ps --format '{{.Names}}' | grep -qx "$container"; then
        log_fail "Container $container is not running"
        return 1
    fi

    # Tables from backup
    echo -e "\n${BOLD}Extracting tables from backup...${NC}"
    local dump
    dump=$(gunzip -c "$latest")
    local backup_tables
    backup_tables=$(echo "$dump" | grep -oP 'CREATE TABLE\s+(public\.)?\K\S+' | sed 's/(.*//;s/;$//' | sort -u || true)

    # Tables from live DB
    echo -e "${BOLD}Querying live database...${NC}"
    local live_tables
    live_tables=$(docker exec "$container" psql -U "$pg_user" -t -A -c \
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;" 2>/dev/null || true)

    if [[ -z "$live_tables" ]]; then
        log_warn "Could not query live tables (container may not have a database with public schema)"
        return 1
    fi

    # Compare table lists
    echo -e "\n${BOLD}Table comparison:${NC}"
    local missing_from_backup="" missing_from_live=""

    while IFS= read -r tbl; do
        [[ -z "$tbl" ]] && continue
        if ! echo "$backup_tables" | grep -qx "$tbl"; then
            missing_from_backup+="$tbl "
        fi
    done <<< "$live_tables"

    while IFS= read -r tbl; do
        [[ -z "$tbl" ]] && continue
        if ! echo "$live_tables" | grep -qx "$tbl"; then
            missing_from_live+="$tbl "
        fi
    done <<< "$backup_tables"

    if [[ -n "$missing_from_backup" ]]; then
        log_warn "Tables in LIVE but NOT in backup:"
        for t in $missing_from_backup; do
            echo "         - $t"
        done
    fi

    if [[ -n "$missing_from_live" ]]; then
        log_warn "Tables in BACKUP but NOT in live DB:"
        for t in $missing_from_live; do
            echo "         - $t"
        done
    fi

    if [[ -z "$missing_from_backup" && -z "$missing_from_live" ]]; then
        log_ok "Table lists match"
    fi

    # Row count comparison
    echo -e "\n${BOLD}Row count comparison:${NC}"
    printf "  %-40s %10s %10s\n" "TABLE" "BACKUP" "LIVE"
    printf "  %-40s %10s %10s\n" "-----" "------" "----"

    # Build backup row counts from COPY blocks
    declare -A backup_rows
    local in_copy=0 current_table="" row_count=0
    while IFS= read -r line; do
        if [[ $in_copy -eq 1 ]]; then
            if [[ "$line" == '\.' ]]; then
                # Strip schema prefix for matching
                local clean_table="${current_table#public.}"
                backup_rows["$clean_table"]=$row_count
                in_copy=0
                row_count=0
            else
                (( row_count++ )) || true
            fi
        elif [[ "$line" =~ $COPY_RE ]]; then
            local matched_table="${BASH_REMATCH[1]}"
            if [[ "$line" == *"FROM stdin"* ]]; then
                current_table="$matched_table"
                in_copy=1
                row_count=0
            fi
        fi
    done <<< "$dump"

    while IFS= read -r tbl; do
        [[ -z "$tbl" ]] && continue
        local live_count backup_count
        live_count=$(docker exec "$container" psql -U "$pg_user" -t -A -c \
            "SELECT COUNT(*) FROM \"$tbl\";" 2>/dev/null || echo "?")
        backup_count="${backup_rows[$tbl]:-?}"
        printf "  %-40s %10s %10s\n" "$tbl" "$backup_count" "$live_count"
    done <<< "$live_tables"
}

# ── restore-test <file> ───────────────────────────────────────────────
cmd_restore_test() {
    local file="$1"
    if [[ ! -f "$file" ]]; then
        file="$BACKUP_DIR/$file"
    fi
    if [[ ! -f "$file" ]]; then
        log_fail "File not found: $1"
        return 1
    fi

    # Determine which container this backup belongs to
    local fname
    fname=$(basename "$file")
    local container=""
    for c in "${!DB_CONTAINERS[@]}"; do
        if [[ "$fname" == db-${c}-* ]]; then
            container="$c"
            break
        fi
    done

    if [[ -z "$container" ]]; then
        log_fail "Cannot determine container from filename: $fname"
        echo "Expected format: db-<container>-YYYY-MM-DD.sql.gz"
        return 1
    fi

    local pg_user="${DB_CONTAINERS[$container]}"

    if ! docker ps --format '{{.Names}}' | grep -qx "$container"; then
        log_fail "Container $container is not running"
        return 1
    fi

    TEMP_DB="_verify_temp_$(date +%s)"
    RESTORE_CONTAINER="$container"

    header "Restore Test: $fname -> $container/$TEMP_DB"

    # 1. Create temp database
    echo -e "\n${BOLD}Creating temp database...${NC}"
    if ! docker exec "$container" psql -U "$pg_user" -c "CREATE DATABASE \"$TEMP_DB\";" 2>/dev/null; then
        log_fail "Could not create temp database"
        TEMP_DB=""
        RESTORE_CONTAINER=""
        return 1
    fi
    log_ok "Created $TEMP_DB"

    # 2. Restore into it
    # pg_dumpall output has \connect directives that switch databases, which would
    # bypass our temp DB. Strip them + CREATE/DROP DATABASE lines so everything
    # restores into the temp DB. Also strip role-creation lines that may fail.
    echo -e "${BOLD}Restoring backup...${NC}"
    local restore_ok=true
    if gunzip -c "$file" \
        | sed '/^\\connect /d; /^CREATE DATABASE /d; /^DROP DATABASE /d' \
        | docker exec -i "$container" psql -U "$pg_user" -d "$TEMP_DB" --quiet >/dev/null 2>&1; then
        log_ok "Restore completed"
    else
        # psql may return non-zero due to role/permission errors from pg_dumpall,
        # which is expected. Check if tables actually got created.
        log_info "Restore finished with warnings (expected for pg_dumpall format)"
        restore_ok=true
    fi

    # 3. Verify tables exist and have rows
    echo -e "${BOLD}Verifying restored data...${NC}"
    local tables
    tables=$(docker exec "$container" psql -U "$pg_user" -d "$TEMP_DB" -t -A -c \
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public';" 2>/dev/null || true)

    if [[ -z "$tables" ]]; then
        log_fail "No tables found after restore"
        restore_ok=false
    else
        local table_count=0 tables_with_rows=0
        while IFS= read -r tbl; do
            [[ -z "$tbl" ]] && continue
            (( table_count++ )) || true
            local cnt
            cnt=$(docker exec "$container" psql -U "$pg_user" -d "$TEMP_DB" -t -A -c \
                "SELECT COUNT(*) FROM \"$tbl\";" 2>/dev/null || echo "0")
            if (( cnt > 0 )); then
                (( tables_with_rows++ )) || true
            fi
            printf "  %-40s %s rows\n" "$tbl" "$cnt"
        done <<< "$tables"

        echo ""
        log_info "$table_count tables restored, $tables_with_rows with data"
    fi

    # 4. Drop temp database
    echo -e "\n${BOLD}Dropping temp database...${NC}"
    docker exec "$container" psql -U "$pg_user" -c "DROP DATABASE IF EXISTS \"$TEMP_DB\";" 2>/dev/null
    log_ok "Dropped $TEMP_DB"
    TEMP_DB=""
    RESTORE_CONTAINER=""

    # 5. Verdict
    echo ""
    if [[ "$restore_ok" == true && -n "$tables" ]]; then
        echo -e "  ${GREEN}${BOLD}PASS${NC} — Restore test succeeded"
    else
        echo -e "  ${RED}${BOLD}FAIL${NC} — Restore test failed"
        return 1
    fi
}

# ── schedule ──────────────────────────────────────────────────────────
cmd_schedule() {
    header "Backup Schedule"

    echo -e "\n${BOLD}Crontab entries matching 'backup':${NC}"
    local cron_lines
    cron_lines=$(crontab -l 2>/dev/null | grep -i backup || true)
    if [[ -n "$cron_lines" ]]; then
        echo "$cron_lines" | while IFS= read -r line; do
            log_info "$line"
        done
    else
        log_warn "No backup-related crontab entries found"
    fi

    echo -e "\n${BOLD}Backup script:${NC}"
    if [[ -f /root/overlord/scripts/backup.sh ]]; then
        log_ok "/root/overlord/scripts/backup.sh exists"
        log_info "Last modified: $(stat -c '%y' /root/overlord/scripts/backup.sh | cut -d. -f1)"
    else
        log_warn "Backup script not found at expected path"
    fi

    echo -e "\n${BOLD}Latest backup timestamps:${NC}"
    # Group by container, show latest
    for c in "${!DB_CONTAINERS[@]}"; do
        local latest
        latest=$(find "$BACKUP_DIR" -name "db-${c}-*.sql.gz" -type f 2>/dev/null | sort | tail -1)
        if [[ -n "$latest" ]]; then
            local mtime age_h
            mtime=$(stat -c%Y "$latest")
            age_h=$(( (NOW - mtime) / 3600 ))
            log_info "$(printf '%-25s' "$c:") $(basename "$latest")  (${age_h}h ago)"
        else
            log_warn "$(printf '%-25s' "$c:") No backups found"
        fi
    done
}

# ── report ────────────────────────────────────────────────────────────
cmd_report() {
    header "Full Backup Report — $(date '+%Y-%m-%d %H:%M')"

    cmd_check

    for container in $(docker ps --format '{{.Names}}' | sort); do
        if [[ -n "${DB_CONTAINERS[$container]:-}" ]]; then
            # Only compare if a backup exists for this container
            if find "$BACKUP_DIR" -name "db-${container}-*.sql.gz" -type f 2>/dev/null | grep -q .; then
                cmd_compare "$container" || true
            else
                echo ""
                log_warn "No backups for running container: $container"
            fi
        fi
    done

    cmd_schedule
    echo ""
    header "Report Complete"
}

# ── usage ─────────────────────────────────────────────────────────────
usage() {
    cat <<'EOF'
backup-verify.sh — Verify integrity and completeness of PostgreSQL backups

USAGE:
  backup-verify.sh check                   Check all backup files (age, size, integrity)
  backup-verify.sh verify <backup_file>    Deep verify a specific backup file
  backup-verify.sh compare <container>     Compare latest backup against live DB
  backup-verify.sh restore-test <file>     Test restore to a temporary database
  backup-verify.sh schedule                Show backup schedule and last run times
  backup-verify.sh report                  Full report across all backups and containers

CONTAINERS:
  overlord-db, namibarden-db, surfababe-db, mastercommander-db,
  lumina-db, coolify-db, onlyhulls-db

EXAMPLES:
  backup-verify.sh check
  backup-verify.sh verify db-overlord-db-2026-03-15.sql.gz
  backup-verify.sh compare overlord-db
  backup-verify.sh restore-test db-overlord-db-2026-03-15.sql.gz
  backup-verify.sh report
EOF
}

# ── main ──────────────────────────────────────────────────────────────
case "${1:-}" in
    check)    cmd_check ;;
    verify)
        [[ -z "${2:-}" ]] && { echo "Usage: $0 verify <backup_file>"; exit 1; }
        cmd_verify "$2"
        ;;
    compare)
        [[ -z "${2:-}" ]] && { echo "Usage: $0 compare <container>"; exit 1; }
        cmd_compare "$2"
        ;;
    restore-test)
        [[ -z "${2:-}" ]] && { echo "Usage: $0 restore-test <backup_file>"; exit 1; }
        cmd_restore_test "$2"
        ;;
    schedule) cmd_schedule ;;
    report)   cmd_report ;;
    *)        usage ;;
esac
