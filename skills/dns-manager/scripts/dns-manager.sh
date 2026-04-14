#!/bin/bash
# dns-manager — Cloudflare DNS management for all zones
# Usage: dns-manager.sh <command> [args...]
set -euo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────

ENV_FILE="/root/overlord/.env"

load_env() {
  if [ -n "${CF_API_KEY:-}" ] && [ -n "${CF_EMAIL:-}" ]; then
    return
  fi
  if [ -f "$ENV_FILE" ]; then
    CF_API_KEY="${CF_API_KEY:-$(grep '^CLOUDFLARE_GLOBAL_API_KEY=' "$ENV_FILE" | cut -d'=' -f2-)}"
    CF_EMAIL="${CF_EMAIL:-$(grep '^CLOUDFLARE_EMAIL=' "$ENV_FILE" | cut -d'=' -f2-)}"
  fi
  if [ -z "${CF_API_KEY:-}" ] || [ -z "${CF_EMAIL:-}" ]; then
    echo "ERROR: CLOUDFLARE_GLOBAL_API_KEY and CLOUDFLARE_EMAIL must be set in env or $ENV_FILE"
    exit 1
  fi
}

CF_API="https://api.cloudflare.com/client/v4"
DEFAULT_DOMAIN="namibarden.com"

cf_curl() {
  local method="$1" endpoint="$2"
  shift 2
  curl -s -X "$method" "${CF_API}${endpoint}" \
    -H "X-Auth-Email: $CF_EMAIL" \
    -H "X-Auth-Key: $CF_API_KEY" \
    -H "Content-Type: application/json" \
    "$@"
}

check_success() {
  local response="$1"
  local success
  success=$(echo "$response" | jq -r '.success // false')
  if [ "$success" != "true" ]; then
    echo "ERROR: API call failed"
    echo "$response" | jq -r '.errors[]?.message // .errors // "Unknown error"' 2>/dev/null
    return 1
  fi
}

# ── ZONE HELPERS ──────────────────────────────────────────────────────────────

get_zone_id() {
  local domain="${1:-$DEFAULT_DOMAIN}"
  local response
  response=$(cf_curl GET "/zones?name=${domain}&status=active")
  check_success "$response" || return 1
  local zone_id
  zone_id=$(echo "$response" | jq -r '.result[0].id // empty')
  if [ -z "$zone_id" ]; then
    echo "ERROR: Zone not found for domain: $domain" >&2
    return 1
  fi
  echo "$zone_id"
}

# Determine zone from a full record name (e.g., sub.namibarden.com -> namibarden.com)
detect_zone() {
  local name="$1"
  local zones=("namibarden.com" "onlyhulls.com" "onlydrafting.com")
  for z in "${zones[@]}"; do
    if [[ "$name" == *"$z" ]] || [[ "$name" == "$z" ]]; then
      echo "$z"
      return
    fi
  done
  echo "$DEFAULT_DOMAIN"
}

get_server_ip() {
  if [ -n "${SERVER_IP:-}" ]; then
    echo "$SERVER_IP"
  else
    curl -s ifconfig.me
  fi
}

# ── COMMANDS ──────────────────────────────────────────────────────────────────

cmd_zones() {
  echo "=== Cloudflare Zones ==="
  echo ""
  local response
  response=$(cf_curl GET "/zones?per_page=50")
  check_success "$response" || return 1
  printf "%-30s %-34s %-10s %s\n" "DOMAIN" "ZONE ID" "STATUS" "PLAN"
  printf "%-30s %-34s %-10s %s\n" "------" "-------" "------" "----"
  echo "$response" | jq -r '.result[] | [.name, .id, .status, .plan.name] | @tsv' | \
    while IFS=$'\t' read -r name id status plan; do
      printf "%-30s %-34s %-10s %s\n" "$name" "$id" "$status" "$plan"
    done
}

cmd_list() {
  local domain="${1:-$DEFAULT_DOMAIN}"
  local zone_id
  zone_id=$(get_zone_id "$domain") || return 1

  echo "=== DNS Records for $domain ==="
  echo ""

  local page=1
  local total_pages=1
  local all_records="[]"

  while [ "$page" -le "$total_pages" ]; do
    local response
    response=$(cf_curl GET "/zones/${zone_id}/dns_records?per_page=100&page=${page}")
    check_success "$response" || return 1
    total_pages=$(echo "$response" | jq -r '.result_info.total_pages // 1')
    all_records=$(echo "$all_records" | jq --argjson new "$(echo "$response" | jq '.result')" '. + $new')
    page=$((page + 1))
  done

  local count
  count=$(echo "$all_records" | jq 'length')
  printf "%-6s %-35s %-45s %-8s %-34s\n" "TYPE" "NAME" "CONTENT" "PROXIED" "ID"
  printf "%-6s %-35s %-45s %-8s %-34s\n" "----" "----" "-------" "-------" "--"
  echo "$all_records" | jq -r '.[] | [.type, .name, .content, (if .proxied then "yes" else "no" end), .id] | @tsv' | \
    while IFS=$'\t' read -r type name content proxied id; do
      printf "%-6s %-35s %-45s %-8s %-34s\n" "$type" "${name:0:35}" "${content:0:45}" "$proxied" "$id"
    done
  echo ""
  echo "Total: $count records"
}

cmd_add() {
  local type="${1:?Usage: dns-manager.sh add <type> <name> <content> [--proxy] [--domain <domain>]}"
  local name="${2:?Usage: dns-manager.sh add <type> <name> <content> [--proxy] [--domain <domain>]}"
  local content="${3:?Usage: dns-manager.sh add <type> <name> <content> [--proxy] [--domain <domain>]}"
  shift 3

  local proxied="false"
  local domain=""
  local ttl=1
  local priority=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --proxy) proxied="true" ;;
      --domain) domain="$2"; shift ;;
      --ttl) ttl="$2"; shift ;;
      --priority) priority="$2"; shift ;;
      *) echo "Unknown option: $1"; return 1 ;;
    esac
    shift
  done

  type=$(echo "$type" | tr '[:lower:]' '[:upper:]')

  # Validate type
  case "$type" in
    A|AAAA|CNAME|TXT|MX|NS|SRV|CAA) ;;
    *) echo "ERROR: Unsupported record type: $type"; return 1 ;;
  esac

  # Auto-detect zone from name if domain not specified
  if [ -z "$domain" ]; then
    domain=$(detect_zone "$name")
  fi

  local zone_id
  zone_id=$(get_zone_id "$domain") || return 1

  # Build JSON payload
  local data
  data=$(jq -n \
    --arg type "$type" \
    --arg name "$name" \
    --arg content "$content" \
    --argjson proxied "$proxied" \
    --argjson ttl "$ttl" \
    '{type: $type, name: $name, content: $content, proxied: $proxied, ttl: $ttl}')

  if [ -n "$priority" ]; then
    data=$(echo "$data" | jq --argjson p "$priority" '. + {priority: $p}')
  fi

  echo "Adding $type record: $name -> $content (proxied: $proxied, zone: $domain)"
  local response
  response=$(cf_curl POST "/zones/${zone_id}/dns_records" -d "$data")
  check_success "$response" || return 1

  local record_id
  record_id=$(echo "$response" | jq -r '.result.id')
  echo "Created record: $record_id"
  echo "$response" | jq '.result | {id, type, name, content, proxied, ttl}'
}

cmd_delete() {
  local record_id="${1:?Usage: dns-manager.sh delete <record_id> [--domain <domain>]}"
  shift
  local domain="$DEFAULT_DOMAIN"

  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) domain="$2"; shift ;;
      *) ;;
    esac
    shift
  done

  local zone_id
  zone_id=$(get_zone_id "$domain") || return 1

  # Fetch record details first
  local response
  response=$(cf_curl GET "/zones/${zone_id}/dns_records/${record_id}")
  check_success "$response" || return 1

  echo "=== Record to Delete ==="
  echo "$response" | jq '.result | {id, type, name, content, proxied, ttl}'
  echo ""
  echo "WARNING: This will permanently delete the above record."
  echo "To confirm, re-run with --confirm:"
  echo "  dns-manager.sh delete $record_id --confirm --domain $domain"

  # Check for --confirm in original args
  local confirmed="false"
  for arg in "$@"; do
    [ "$arg" = "--confirm" ] && confirmed="true"
  done

  # Also check if --confirm was passed originally (we consumed args above, so re-check)
  if [ "$confirmed" = "true" ]; then
    response=$(cf_curl DELETE "/zones/${zone_id}/dns_records/${record_id}")
    check_success "$response" || return 1
    echo "Record deleted."
  fi
}

# Re-implement delete to properly handle --confirm
cmd_delete() {
  local record_id="${1:?Usage: dns-manager.sh delete <record_id> [--domain <domain>] [--confirm]}"
  shift
  local domain="$DEFAULT_DOMAIN"
  local confirmed="false"

  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) domain="$2"; shift ;;
      --confirm) confirmed="true" ;;
      *) ;;
    esac
    shift
  done

  local zone_id
  zone_id=$(get_zone_id "$domain") || return 1

  # Fetch record details first
  local response
  response=$(cf_curl GET "/zones/${zone_id}/dns_records/${record_id}")
  check_success "$response" || return 1

  echo "=== Record to Delete ==="
  echo "$response" | jq '.result | {id, type, name, content, proxied, ttl}'
  echo ""

  if [ "$confirmed" = "true" ]; then
    response=$(cf_curl DELETE "/zones/${zone_id}/dns_records/${record_id}")
    check_success "$response" || return 1
    echo "Record deleted."
  else
    echo "WARNING: This will permanently delete the above record."
    echo "To confirm, re-run with --confirm:"
    echo "  dns-manager.sh delete $record_id --confirm --domain $domain"
  fi
}

cmd_update() {
  local record_id="${1:?Usage: dns-manager.sh update <record_id> <content> [--domain <domain>] [--proxy]}"
  local content="${2:?Usage: dns-manager.sh update <record_id> <content> [--domain <domain>] [--proxy]}"
  shift 2

  local domain="$DEFAULT_DOMAIN"
  local set_proxy=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) domain="$2"; shift ;;
      --proxy) set_proxy="true" ;;
      --no-proxy) set_proxy="false" ;;
      *) ;;
    esac
    shift
  done

  local zone_id
  zone_id=$(get_zone_id "$domain") || return 1

  # Get current record
  local current
  current=$(cf_curl GET "/zones/${zone_id}/dns_records/${record_id}")
  check_success "$current" || return 1

  local type name proxied ttl
  type=$(echo "$current" | jq -r '.result.type')
  name=$(echo "$current" | jq -r '.result.name')
  proxied=$(echo "$current" | jq -r '.result.proxied')
  ttl=$(echo "$current" | jq -r '.result.ttl')

  [ -n "$set_proxy" ] && proxied="$set_proxy"

  local data
  data=$(jq -n \
    --arg type "$type" \
    --arg name "$name" \
    --arg content "$content" \
    --argjson proxied "$proxied" \
    --argjson ttl "$ttl" \
    '{type: $type, name: $name, content: $content, proxied: $proxied, ttl: $ttl}')

  echo "Updating $type record: $name -> $content"
  local response
  response=$(cf_curl PUT "/zones/${zone_id}/dns_records/${record_id}" -d "$data")
  check_success "$response" || return 1

  echo "Updated."
  echo "$response" | jq '.result | {id, type, name, content, proxied, ttl}'
}

cmd_find() {
  local pattern="${1:?Usage: dns-manager.sh find <name_pattern> [--domain <domain>]}"
  shift
  local domain="$DEFAULT_DOMAIN"

  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) domain="$2"; shift ;;
      *) ;;
    esac
    shift
  done

  local zone_id
  zone_id=$(get_zone_id "$domain") || return 1

  echo "=== Searching for '$pattern' in $domain ==="
  echo ""

  local response
  response=$(cf_curl GET "/zones/${zone_id}/dns_records?name=contains:${pattern}&per_page=100")
  check_success "$response" || return 1

  local count
  count=$(echo "$response" | jq '.result | length')

  if [ "$count" -eq 0 ]; then
    # Cloudflare's contains filter can be picky; fallback to client-side filter
    response=$(cf_curl GET "/zones/${zone_id}/dns_records?per_page=100")
    check_success "$response" || return 1
    local filtered
    filtered=$(echo "$response" | jq --arg pat "$pattern" '[.result[] | select(.name | test($pat; "i"))]')
    count=$(echo "$filtered" | jq 'length')

    if [ "$count" -eq 0 ]; then
      echo "No records matching '$pattern'"
      return 0
    fi

    printf "%-6s %-35s %-45s %-8s %-34s\n" "TYPE" "NAME" "CONTENT" "PROXIED" "ID"
    printf "%-6s %-35s %-45s %-8s %-34s\n" "----" "----" "-------" "-------" "--"
    echo "$filtered" | jq -r '.[] | [.type, .name, .content, (if .proxied then "yes" else "no" end), .id] | @tsv' | \
      while IFS=$'\t' read -r type name content proxied id; do
        printf "%-6s %-35s %-45s %-8s %-34s\n" "$type" "${name:0:35}" "${content:0:45}" "$proxied" "$id"
      done
  else
    printf "%-6s %-35s %-45s %-8s %-34s\n" "TYPE" "NAME" "CONTENT" "PROXIED" "ID"
    printf "%-6s %-35s %-45s %-8s %-34s\n" "----" "----" "-------" "-------" "--"
    echo "$response" | jq -r '.result[] | [.type, .name, .content, (if .proxied then "yes" else "no" end), .id] | @tsv' | \
      while IFS=$'\t' read -r type name content proxied id; do
        printf "%-6s %-35s %-45s %-8s %-34s\n" "$type" "${name:0:35}" "${content:0:45}" "$proxied" "$id"
      done
  fi
  echo ""
  echo "Found: $count records"
}

cmd_check() {
  local subdomain="${1:?Usage: dns-manager.sh check <subdomain>}"
  local domain="${2:-$DEFAULT_DOMAIN}"

  local fqdn
  if [[ "$subdomain" == *.* ]]; then
    fqdn="$subdomain"
  else
    fqdn="${subdomain}.${domain}"
  fi

  echo "=== DNS Check: $fqdn ==="
  echo ""

  # dig lookup
  echo "--- dig A record ---"
  dig +short A "$fqdn" 2>/dev/null || echo "(dig failed)"
  echo ""

  echo "--- dig AAAA record ---"
  dig +short AAAA "$fqdn" 2>/dev/null || echo "(no AAAA)"
  echo ""

  echo "--- dig CNAME record ---"
  dig +short CNAME "$fqdn" 2>/dev/null || echo "(no CNAME)"
  echo ""

  # HTTP check
  echo "--- HTTP check ---"
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://${fqdn}" 2>/dev/null || echo "000")
  echo "HTTP status: $http_code"

  local https_code
  https_code=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "https://${fqdn}" 2>/dev/null || echo "000")
  echo "HTTPS status: $https_code"

  echo ""

  # Cloudflare record check
  echo "--- Cloudflare record ---"
  local zone_id
  zone_id=$(get_zone_id "$(detect_zone "$fqdn")") || return 1
  local response
  response=$(cf_curl GET "/zones/${zone_id}/dns_records?name=${fqdn}")
  check_success "$response" || return 1
  local count
  count=$(echo "$response" | jq '.result | length')
  if [ "$count" -eq 0 ]; then
    echo "No Cloudflare record found for $fqdn"
  else
    echo "$response" | jq -r '.result[] | "  \(.type) -> \(.content) (proxied: \(.proxied))"'
  fi
}

cmd_new_site() {
  local subdomain="${1:?Usage: dns-manager.sh new-site <subdomain> [--domain <domain>]}"
  shift
  local domain="$DEFAULT_DOMAIN"

  while [ $# -gt 0 ]; do
    case "$1" in
      --domain) domain="$2"; shift ;;
      *) ;;
    esac
    shift
  done

  local fqdn="${subdomain}.${domain}"
  local server_ip
  server_ip=$(get_server_ip)

  echo "=== New Site Setup: $fqdn ==="
  echo ""
  echo "Server IP: $server_ip"
  echo ""

  # Check if record already exists
  local zone_id
  zone_id=$(get_zone_id "$domain") || return 1
  local existing
  existing=$(cf_curl GET "/zones/${zone_id}/dns_records?name=${fqdn}&type=A")
  check_success "$existing" || return 1
  local existing_count
  existing_count=$(echo "$existing" | jq '.result | length')
  if [ "$existing_count" -gt 0 ]; then
    echo "WARNING: A record already exists for $fqdn:"
    echo "$existing" | jq -r '.result[] | "  \(.type) -> \(.content) (id: \(.id))"'
    echo ""
    echo "Delete existing record first, or use 'update' to change it."
    return 1
  fi

  # Step 1: Create A record (proxied)
  echo "Step 1: Creating A record $fqdn -> $server_ip (proxied)..."
  local data
  data=$(jq -n \
    --arg name "$fqdn" \
    --arg content "$server_ip" \
    '{type: "A", name: $name, content: $content, proxied: true, ttl: 1}')
  local response
  response=$(cf_curl POST "/zones/${zone_id}/dns_records" -d "$data")
  check_success "$response" || return 1
  local record_id
  record_id=$(echo "$response" | jq -r '.result.id')
  echo "  Created record: $record_id"

  # Step 2: Wait for propagation
  echo ""
  echo "Step 2: Waiting 5 seconds for DNS propagation..."
  sleep 5

  # Step 3: Verify with dig
  echo ""
  echo "Step 3: Verifying DNS..."
  local resolved
  resolved=$(dig +short A "$fqdn" 2>/dev/null || true)
  if [ -n "$resolved" ]; then
    echo "  dig result: $resolved"
    echo "  (Cloudflare proxy IPs expected when proxied)"
  else
    echo "  dig returned no result yet (may take a few more seconds to propagate)"
  fi

  echo ""
  echo "============================================"
  echo "Ready! Add Traefik route for ${fqdn}"
  echo "  Config: /data/coolify/proxy/dynamic/namibarden.yaml"
  echo "  Record ID: $record_id"
  echo "============================================"
}

cmd_ssl_status() {
  local domain="${1:-$DEFAULT_DOMAIN}"
  local zone_id
  zone_id=$(get_zone_id "$domain") || return 1

  echo "=== SSL/TLS Status for $domain ==="
  echo ""

  # SSL setting
  local response
  response=$(cf_curl GET "/zones/${zone_id}/settings/ssl")
  check_success "$response" || return 1
  local ssl_mode
  ssl_mode=$(echo "$response" | jq -r '.result.value')
  echo "SSL Mode: $ssl_mode"

  # Always Use HTTPS
  response=$(cf_curl GET "/zones/${zone_id}/settings/always_use_https")
  check_success "$response" || return 1
  local always_https
  always_https=$(echo "$response" | jq -r '.result.value')
  echo "Always Use HTTPS: $always_https"

  # Min TLS version
  response=$(cf_curl GET "/zones/${zone_id}/settings/min_tls_version")
  check_success "$response" || return 1
  local min_tls
  min_tls=$(echo "$response" | jq -r '.result.value')
  echo "Min TLS Version: $min_tls"

  # Automatic HTTPS Rewrites
  response=$(cf_curl GET "/zones/${zone_id}/settings/automatic_https_rewrites")
  check_success "$response" || return 1
  local auto_rewrites
  auto_rewrites=$(echo "$response" | jq -r '.result.value')
  echo "Auto HTTPS Rewrites: $auto_rewrites"

  # Universal SSL verification
  echo ""
  echo "--- Certificate Status ---"
  response=$(cf_curl GET "/zones/${zone_id}/ssl/verification")
  check_success "$response" || return 1
  echo "$response" | jq -r '.result[] | "  \(.hostname): \(.certificate_status) (method: \(.validation_method // "n/a"))"' 2>/dev/null || \
    echo "  (No certificate details available)"
}

# ── USAGE ─────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
dns-manager — Cloudflare DNS management

ZONES:
  dns-manager.sh zones                          List all zones in the account

RECORDS:
  dns-manager.sh list [domain]                  List all DNS records (default: namibarden.com)
  dns-manager.sh find <pattern> [--domain d]    Search records by name pattern
  dns-manager.sh add <type> <name> <content>    Add DNS record (A, AAAA, CNAME, TXT, MX)
                  [--proxy] [--domain d]          --proxy enables Cloudflare proxying
                  [--ttl n] [--priority n]
  dns-manager.sh update <id> <content>          Update record content
                  [--domain d] [--proxy|--no-proxy]
  dns-manager.sh delete <id> [--domain d]       Show record details (requires --confirm to delete)
                  [--confirm]

DIAGNOSTICS:
  dns-manager.sh check <subdomain> [domain]     Check if subdomain resolves (dig + curl)
  dns-manager.sh ssl-status [domain]            Check SSL/TLS settings for zone

WORKFLOWS:
  dns-manager.sh new-site <subdomain>           Create A record -> server IP + verify propagation
                  [--domain d]

MANAGED ZONES:
  namibarden.com (default), onlyhulls.com, onlydrafting.com

ENVIRONMENT:
  CF_API_KEY    Cloudflare Global API Key (or CLOUDFLARE_GLOBAL_API_KEY in .env)
  CF_EMAIL      Cloudflare email (or CLOUDFLARE_EMAIL in .env)
  SERVER_IP     Override server IP detection (default: curl ifconfig.me)

EXAMPLES:
  dns-manager.sh zones
  dns-manager.sh list
  dns-manager.sh list onlyhulls.com
  dns-manager.sh find beastmode
  dns-manager.sh add A test 5.78.82.169 --proxy
  dns-manager.sh add TXT _dmarc "v=DMARC1; p=none"
  dns-manager.sh add MX mail mail.namibarden.com --priority 10
  dns-manager.sh update abc123def456 5.78.82.170
  dns-manager.sh delete abc123def456 --confirm
  dns-manager.sh check beastmode
  dns-manager.sh check beastmode.namibarden.com
  dns-manager.sh new-site myapp
  dns-manager.sh new-site store --domain onlyhulls.com
  dns-manager.sh ssl-status
  dns-manager.sh ssl-status onlydrafting.com
USAGE
}

# ── MAIN ──────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

load_env

case "$cmd" in
  zones)            cmd_zones "$@" ;;
  list|ls)          cmd_list "$@" ;;
  add|create)       cmd_add "$@" ;;
  delete|rm)        cmd_delete "$@" ;;
  update|set)       cmd_update "$@" ;;
  find|search)      cmd_find "$@" ;;
  check)            cmd_check "$@" ;;
  new-site|newsite) cmd_new_site "$@" ;;
  ssl-status|ssl)   cmd_ssl_status "$@" ;;
  help|--help|-h)   usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: dns-manager.sh help"
    exit 1
    ;;
esac
