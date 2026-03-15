#!/bin/bash
# database-admin — Unified PostgreSQL management across all project containers
# Usage: db-admin.sh <command> [args...]
set -euo pipefail

# ── DISCOVERY ─────────────────────────────────────────────────────────────────

discover_pg_containers() {
  docker ps --format '{{.Names}}' | while read -r name; do
    img=$(docker inspect --format '{{.Config.Image}}' "$name" 2>/dev/null || true)
    if echo "$img" | grep -qi 'postgres'; then
      user=$(docker exec "$name" bash -c 'echo $POSTGRES_USER' 2>/dev/null || echo "postgres")
      [ -z "$user" ] && user="postgres"
      echo "$name|$user|$img"
    fi
  done
}

get_pg_user() {
  local container="$1"
  docker exec "$container" bash -c 'echo ${POSTGRES_USER:-postgres}' 2>/dev/null || echo "postgres"
}

run_psql() {
  local container="$1" user="$2"
  shift 2
  docker exec "$container" psql -U "$user" -t -A "$@" 2>/dev/null
}

run_psql_pretty() {
  local container="$1" user="$2"
  shift 2
  docker exec "$container" psql -U "$user" "$@" 2>/dev/null
}

# ── COMMANDS ──────────────────────────────────────────────────────────────────

cmd_list() {
  echo "=== PostgreSQL Containers ==="
  echo ""
  printf "%-25s %-15s %-30s %s\n" "CONTAINER" "USER" "IMAGE" "STATUS"
  printf "%-25s %-15s %-30s %s\n" "---------" "----" "-----" "------"
  discover_pg_containers | while IFS='|' read -r name user img; do
    status=$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || echo "running")
    printf "%-25s %-15s %-30s %s\n" "$name" "$user" "$img" "$status"
  done
  echo ""
  echo "Use: db-admin.sh databases <container> — to list databases in a container"
}

cmd_databases() {
  local container="${1:?Usage: db-admin.sh databases <container>}"
  local user
  user=$(get_pg_user "$container")
  echo "=== Databases in $container ==="
  echo ""
  run_psql_pretty "$container" "$user" -c "
    SELECT d.datname AS database,
           pg_size_pretty(pg_database_size(d.datname)) AS size,
           numbackends AS connections
    FROM pg_database d
    JOIN pg_stat_database s ON d.datname = s.datname
    WHERE d.datistemplate = false
    ORDER BY pg_database_size(d.datname) DESC;
  "
}

cmd_tables() {
  local container="${1:?Usage: db-admin.sh tables <container> [database]}"
  local db="${2:-}"
  local user
  user=$(get_pg_user "$container")
  local dbflag=""
  [ -n "$db" ] && dbflag="-d $db"

  echo "=== Tables in $container${db:+ ($db)} ==="
  echo ""
  run_psql_pretty "$container" "$user" $dbflag -c "
    SELECT schemaname AS schema,
           relname AS table,
           pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) AS total_size,
           pg_size_pretty(pg_relation_size(schemaname || '.' || relname)) AS data_size,
           n_live_tup AS rows
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(schemaname || '.' || relname) DESC;
  "
}

cmd_sizes() {
  local container="${1:?Usage: db-admin.sh sizes <container> [database]}"
  local db="${2:-}"
  local user
  user=$(get_pg_user "$container")
  local dbflag=""
  [ -n "$db" ] && dbflag="-d $db"

  echo "=== Size Report for $container${db:+ ($db)} ==="
  echo ""

  # Database total
  run_psql_pretty "$container" "$user" $dbflag -c "
    SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size;
  "
  echo ""

  # Top tables by size
  echo "Top 15 tables by total size:"
  run_psql_pretty "$container" "$user" $dbflag -c "
    SELECT schemaname || '.' || relname AS table,
           pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) AS total,
           pg_size_pretty(pg_relation_size(schemaname || '.' || relname)) AS data,
           pg_size_pretty(pg_indexes_size(schemaname || '.' || quote_ident(relname))) AS indexes,
           n_live_tup AS rows
    FROM pg_stat_user_tables
    ORDER BY pg_total_relation_size(schemaname || '.' || relname) DESC
    LIMIT 15;
  "

  echo ""
  # Index bloat
  echo "Indexes larger than their tables:"
  run_psql_pretty "$container" "$user" $dbflag -c "
    SELECT schemaname || '.' || relname AS table,
           pg_size_pretty(pg_relation_size(schemaname || '.' || relname)) AS data,
           pg_size_pretty(pg_indexes_size(schemaname || '.' || quote_ident(relname))) AS indexes
    FROM pg_stat_user_tables
    WHERE pg_indexes_size(schemaname || '.' || quote_ident(relname)) > pg_relation_size(schemaname || '.' || relname)
      AND pg_relation_size(schemaname || '.' || relname) > 0
    ORDER BY pg_indexes_size(schemaname || '.' || quote_ident(relname)) DESC
    LIMIT 10;
  "
}

cmd_schema() {
  local container="${1:?Usage: db-admin.sh schema <container> <table> [database]}"
  local table="${2:?Usage: db-admin.sh schema <container> <table> [database]}"
  local db="${3:-}"
  local user
  user=$(get_pg_user "$container")
  local dbflag=""
  [ -n "$db" ] && dbflag="-d $db"

  echo "=== Schema: $table in $container${db:+ ($db)} ==="
  echo ""

  # Columns
  echo "Columns:"
  run_psql_pretty "$container" "$user" $dbflag -c "
    SELECT column_name, data_type,
           CASE WHEN is_nullable = 'NO' THEN 'NOT NULL' ELSE '' END AS nullable,
           column_default
    FROM information_schema.columns
    WHERE table_name = '$table'
    ORDER BY ordinal_position;
  "

  echo ""
  echo "Indexes:"
  run_psql_pretty "$container" "$user" $dbflag -c "
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = '$table';
  "

  echo ""
  echo "Row count & size:"
  run_psql_pretty "$container" "$user" $dbflag -c "
    SELECT n_live_tup AS rows,
           pg_size_pretty(pg_total_relation_size('$table')) AS total_size
    FROM pg_stat_user_tables
    WHERE relname = '$table';
  "
}

cmd_query() {
  local container="${1:?Usage: db-admin.sh query <container> <sql> [database]}"
  local sql="${2:?Usage: db-admin.sh query <container> <sql> [database]}"
  local db="${3:-}"
  local user
  user=$(get_pg_user "$container")
  local dbflag=""
  [ -n "$db" ] && dbflag="-d $db"

  # Safety: block destructive operations unless --force is passed
  local sql_upper
  sql_upper=$(echo "$sql" | tr '[:lower:]' '[:upper:]')
  if echo "$sql_upper" | grep -qE '^\s*(DROP|DELETE|TRUNCATE|ALTER|UPDATE)\s'; then
    if [ "${4:-}" != "--force" ]; then
      echo "BLOCKED: Destructive query detected. Add --force as 4th arg to execute."
      echo "Query: $sql"
      return 1
    fi
    echo "WARNING: Executing destructive query with --force"
  fi

  run_psql_pretty "$container" "$user" $dbflag -c "$sql"
}

cmd_connections() {
  local container="${1:?Usage: db-admin.sh connections <container>}"
  local user
  user=$(get_pg_user "$container")

  echo "=== Connections in $container ==="
  echo ""

  # Summary
  run_psql_pretty "$container" "$user" -c "
    SELECT datname AS database,
           state,
           COUNT(*) AS count,
           MAX(EXTRACT(EPOCH FROM (now() - state_change)))::int AS max_age_secs
    FROM pg_stat_activity
    WHERE pid <> pg_backend_pid()
    GROUP BY datname, state
    ORDER BY count DESC;
  "

  echo ""
  # Max connections vs current
  run_psql_pretty "$container" "$user" -c "
    SELECT setting::int AS max_connections,
           (SELECT COUNT(*) FROM pg_stat_activity) AS current,
           setting::int - (SELECT COUNT(*) FROM pg_stat_activity) AS available
    FROM pg_settings WHERE name = 'max_connections';
  "

  echo ""
  # Long-running queries
  echo "Queries running > 10 seconds:"
  run_psql_pretty "$container" "$user" -c "
    SELECT pid,
           now() - query_start AS duration,
           state,
           LEFT(query, 80) AS query
    FROM pg_stat_activity
    WHERE state = 'active'
      AND now() - query_start > interval '10 seconds'
      AND pid <> pg_backend_pid()
    ORDER BY query_start;
  "
}

cmd_slow() {
  local container="${1:?Usage: db-admin.sh slow <container> [database]}"
  local db="${2:-}"
  local user
  user=$(get_pg_user "$container")
  local dbflag=""
  [ -n "$db" ] && dbflag="-d $db"

  echo "=== Slow Query Analysis for $container${db:+ ($db)} ==="
  echo ""

  # Check if pg_stat_statements is available
  local has_pgss
  has_pgss=$(run_psql "$container" "$user" $dbflag -c "SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'" 2>/dev/null || true)

  if [ -n "$has_pgss" ]; then
    echo "Top 10 slowest queries (avg time):"
    run_psql_pretty "$container" "$user" $dbflag -c "
      SELECT calls,
             ROUND(mean_exec_time::numeric, 2) AS avg_ms,
             ROUND(total_exec_time::numeric, 2) AS total_ms,
             LEFT(query, 100) AS query
      FROM pg_stat_statements
      ORDER BY mean_exec_time DESC
      LIMIT 10;
    "
  else
    echo "pg_stat_statements not installed. Showing current slow queries instead."
    echo ""
    echo "Currently running queries (sorted by duration):"
    run_psql_pretty "$container" "$user" -c "
      SELECT pid,
             now() - query_start AS duration,
             state,
             LEFT(query, 100) AS query
      FROM pg_stat_activity
      WHERE state != 'idle'
        AND pid <> pg_backend_pid()
      ORDER BY query_start;
    "
  fi

  echo ""
  echo "Sequential scan heavy tables (candidates for missing indexes):"
  run_psql_pretty "$container" "$user" $dbflag -c "
    SELECT schemaname || '.' || relname AS table,
           seq_scan,
           COALESCE(idx_scan, 0) AS idx_scan,
           CASE WHEN (seq_scan + COALESCE(idx_scan, 0)) > 0
                THEN ROUND(100.0 * seq_scan / (seq_scan + COALESCE(idx_scan, 0)), 1)
                ELSE 0 END AS seq_pct,
           n_live_tup AS rows
    FROM pg_stat_user_tables
    WHERE seq_scan > 100
    ORDER BY seq_pct DESC
    LIMIT 10;
  "
}

cmd_backup() {
  local container="${1:?Usage: db-admin.sh backup <container> [output_dir]}"
  local outdir="${2:-/root/backups}"
  local user
  user=$(get_pg_user "$container")
  local date
  date=$(date +%Y%m%d_%H%M%S)
  local outfile="$outdir/db-${container}-${date}.sql.gz"

  mkdir -p "$outdir"

  echo "Backing up all databases in $container..."
  docker exec "$container" pg_dumpall -U "$user" | gzip > "$outfile"

  local size
  size=$(du -h "$outfile" | cut -f1)
  echo "Backup complete: $outfile ($size)"
}

cmd_restore() {
  local container="${1:?Usage: db-admin.sh restore <container> <backup_file>}"
  local backup="${2:?Usage: db-admin.sh restore <container> <backup_file>}"
  local user
  user=$(get_pg_user "$container")

  if [ ! -f "$backup" ]; then
    echo "ERROR: Backup file not found: $backup"
    return 1
  fi

  echo "WARNING: This will restore $backup into $container."
  echo "This may overwrite existing data!"
  echo ""
  echo "To confirm, run:"
  echo "  gunzip -c '$backup' | docker exec -i '$container' psql -U '$user'"
  echo ""
  echo "Or for a single database:"
  echo "  gunzip -c '$backup' | docker exec -i '$container' psql -U '$user' -d <dbname>"
}

cmd_health() {
  echo "=== PostgreSQL Health Check (all containers) ==="
  echo ""
  printf "%-25s %-10s %-12s %-10s %-10s %-8s\n" "CONTAINER" "STATUS" "DB SIZE" "CONNS" "TABLES" "UPTIME"
  printf "%-25s %-10s %-12s %-10s %-10s %-8s\n" "---------" "------" "-------" "-----" "------" "------"

  discover_pg_containers | while IFS='|' read -r name user img; do
    local status="OK"
    local hc
    hc=$(docker inspect --format '{{.State.Health.Status}}' "$name" 2>/dev/null || echo "unknown")
    [ "$hc" = "healthy" ] && status="OK" || status="$hc"

    local dbsize
    dbsize=$(run_psql "$name" "$user" -c "SELECT pg_size_pretty(SUM(pg_database_size(datname))) FROM pg_database WHERE datistemplate = false" 2>/dev/null || echo "?")

    local conns
    conns=$(run_psql "$name" "$user" -c "SELECT COUNT(*) FROM pg_stat_activity" 2>/dev/null || echo "?")

    local tables
    tables=$(run_psql "$name" "$user" -c "SELECT COUNT(*) FROM pg_stat_user_tables" 2>/dev/null || echo "?")

    local uptime
    uptime=$(run_psql "$name" "$user" -c "SELECT EXTRACT(EPOCH FROM (now() - pg_postmaster_start_time()))::int / 3600" 2>/dev/null || echo "?")
    [ "$uptime" != "?" ] && uptime="${uptime}h"

    printf "%-25s %-10s %-12s %-10s %-10s %-8s\n" "$name" "$status" "$dbsize" "$conns" "$tables" "$uptime"
  done

  echo ""

  # Check backup freshness
  echo "Latest backups:"
  if [ -d /root/backups ]; then
    ls -lt /root/backups/db-*.sql.gz 2>/dev/null | head -5 | while read -r line; do
      echo "  $line"
    done
    local newest
    newest=$(find /root/backups -name 'db-*.sql.gz' -mmin -1440 -print -quit 2>/dev/null)
    if [ -z "$newest" ]; then
      echo "  WARNING: No backup in last 24 hours!"
    fi
  else
    echo "  WARNING: /root/backups directory not found"
  fi
}

cmd_vacuum() {
  local container="${1:?Usage: db-admin.sh vacuum <container> [database]}"
  local db="${2:-}"
  local user
  user=$(get_pg_user "$container")
  local dbflag=""
  [ -n "$db" ] && dbflag="-d $db"

  echo "=== Vacuum Analysis for $container${db:+ ($db)} ==="
  echo ""
  echo "Tables with dead tuples:"
  run_psql_pretty "$container" "$user" $dbflag -c "
    SELECT schemaname || '.' || relname AS table,
           n_dead_tup AS dead_tuples,
           n_live_tup AS live_tuples,
           CASE WHEN n_live_tup > 0
                THEN ROUND(100.0 * n_dead_tup / n_live_tup, 1)
                ELSE 0 END AS dead_pct,
           last_vacuum,
           last_autovacuum
    FROM pg_stat_user_tables
    WHERE n_dead_tup > 0
    ORDER BY n_dead_tup DESC
    LIMIT 15;
  "

  echo ""
  echo "To run vacuum: db-admin.sh query <container> 'VACUUM ANALYZE <table>' [db] --force"
}

cmd_replication() {
  local container="${1:?Usage: db-admin.sh replication <container>}"
  local user
  user=$(get_pg_user "$container")

  echo "=== Replication Status for $container ==="
  echo ""
  run_psql_pretty "$container" "$user" -c "
    SELECT client_addr, state, sent_lsn, write_lsn, flush_lsn, replay_lsn,
           EXTRACT(EPOCH FROM (now() - write_lag))::int AS write_lag_secs
    FROM pg_stat_replication;
  "

  local count
  count=$(run_psql "$container" "$user" -c "SELECT COUNT(*) FROM pg_stat_replication" 2>/dev/null || echo "0")
  if [ "$count" = "0" ]; then
    echo "No replication configured."
  fi
}

# ── USAGE ─────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
database-admin — Unified PostgreSQL management

DISCOVERY:
  db-admin.sh list                              List all PG containers
  db-admin.sh health                            Health check across all containers

DATABASE INFO:
  db-admin.sh databases <container>             List databases with sizes
  db-admin.sh tables <container> [db]           List tables with sizes and row counts
  db-admin.sh sizes <container> [db]            Detailed size report + index bloat
  db-admin.sh schema <container> <table> [db]   Show table schema, indexes, stats
  db-admin.sh connections <container>            Active connections and long queries

PERFORMANCE:
  db-admin.sh slow <container> [db]             Slow queries + missing index candidates
  db-admin.sh vacuum <container> [db]           Dead tuple analysis, vacuum needs

OPERATIONS:
  db-admin.sh query <container> <sql> [db]      Run SQL (blocks destructive w/o --force)
  db-admin.sh backup <container> [output_dir]   pg_dumpall to gzipped file
  db-admin.sh restore <container> <file>        Show restore instructions (safe)

REPLICATION:
  db-admin.sh replication <container>            Replication lag and status

EXAMPLES:
  db-admin.sh health
  db-admin.sh tables overlord-db
  db-admin.sh sizes overlord-db overlord
  db-admin.sh schema overlord-db semantic_memories overlord
  db-admin.sh slow overlord-db overlord
  db-admin.sh query overlord-db "SELECT COUNT(*) FROM semantic_memories" overlord
  db-admin.sh backup overlord-db
USAGE
}

# ── MAIN ──────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  list)         cmd_list "$@" ;;
  databases|dbs) cmd_databases "$@" ;;
  tables)       cmd_tables "$@" ;;
  sizes)        cmd_sizes "$@" ;;
  schema)       cmd_schema "$@" ;;
  query|sql)    cmd_query "$@" ;;
  connections|conns) cmd_connections "$@" ;;
  slow)         cmd_slow "$@" ;;
  backup)       cmd_backup "$@" ;;
  restore)      cmd_restore "$@" ;;
  health)       cmd_health "$@" ;;
  vacuum)       cmd_vacuum "$@" ;;
  replication|repl) cmd_replication "$@" ;;
  help|--help|-h) usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: db-admin.sh help"
    exit 1
    ;;
esac
