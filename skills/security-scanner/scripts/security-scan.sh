#!/bin/bash
# security-scan.sh — Comprehensive security scanner for Hetzner CX33 / Ubuntu 24.04
# Usage: security-scan.sh <command> [args...]
set -uo pipefail

# ── CONFIG ────────────────────────────────────────────────────────────────────

ALL_DOMAINS="namibarden.com lumina.namibarden.com surfababe.namibarden.com mastercommander.namibarden.com onlyhulls.com onlydrafting.com"
PROJECT_DIRS="/root/projects/* /root/overlord"
SSL_WARN_DAYS=30

# Expected listening ports (add/remove as infrastructure changes)
# Format: port:description
EXPECTED_PORTS=(
  "22:sshd"
  "25:postfix-smtp"
  "53:systemd-resolved"
  "80:traefik-http"
  "443:traefik-https"
  "3001:coolify-ui"
  "3002:coolify-realtime"
  "3010:app-container"
  "5433:postgresql"
  "6001:coolify-soketi"
  "6002:coolify-soketi"
  "6080:novnc"
  "6380:redis"
  "7701:coolify-internal"
  "8000:coolify"
  "9002:surfababe-webhook"
  "9222:chrome-cdp-internal"
  "9223:chrome-cdp"
)

# Required HTTP security headers
SECURITY_HEADERS=(
  "strict-transport-security"
  "x-frame-options"
  "x-content-type-options"
  "x-xss-protection"
  "referrer-policy"
  "content-security-policy"
)

# ── COUNTERS ──────────────────────────────────────────────────────────────────

CRITICAL=0
HIGH=0
MEDIUM=0
LOW=0
PASS=0
REPORT_LINES=()

# ── HELPERS ───────────────────────────────────────────────────────────────────

RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
BOLD='\033[1m'
NC='\033[0m'

log_finding() {
  local severity="$1" category="$2" message="$3"
  local color="$NC"
  case "$severity" in
    CRITICAL) color="$RED"; ((CRITICAL++)) ;;
    HIGH)     color="$RED"; ((HIGH++)) ;;
    MEDIUM)   color="$YELLOW"; ((MEDIUM++)) ;;
    LOW)      color="$CYAN"; ((LOW++)) ;;
    PASS)     color="$GREEN"; ((PASS++)) ;;
  esac
  local line="[$severity] $category: $message"
  REPORT_LINES+=("$line")
  echo -e "${color}${line}${NC}"
}

separator() {
  echo ""
  echo -e "${BOLD}=== $1 ===${NC}"
  echo ""
}

is_port_expected() {
  local port="$1"
  for entry in "${EXPECTED_PORTS[@]}"; do
    local eport="${entry%%:*}"
    if [ "$eport" = "$port" ]; then
      return 0
    fi
  done
  return 1
}

# ── COMMANDS ──────────────────────────────────────────────────────────────────

cmd_ports() {
  separator "Port Scan (localhost)"

  local unexpected=0
  local output
  output=$(ss -tlnp 2>/dev/null)

  echo "$output" | head -1
  echo ""

  while IFS= read -r line; do
    # Extract port from Local Address column — handles formats like *:22, 0.0.0.0:80, [::]:80, 127.0.0.1:8000
    local addr
    addr=$(echo "$line" | awk '{print $4}')
    local port
    port=$(echo "$addr" | rev | cut -d: -f1 | rev)

    # Skip non-numeric
    [[ "$port" =~ ^[0-9]+$ ]] || continue

    local bind_addr="${addr%:$port}"

    # Skip Tailscale-bound ports (100.x.x.x or fd7a: IPv6) — these are private network only
    if [[ "$bind_addr" =~ ^100\. ]] || [[ "$bind_addr" =~ ^\[fd7a: ]]; then
      echo "  OK    :$port (tailscale) — bound to $bind_addr (private)"
      continue
    fi

    if is_port_expected "$port"; then
      local desc=""
      for entry in "${EXPECTED_PORTS[@]}"; do
        local eport="${entry%%:*}"
        local edesc="${entry#*:}"
        if [ "$eport" = "$port" ]; then
          desc="$edesc"
          break
        fi
      done

      # Warn if bound to 0.0.0.0 and not an expected public service
      if [[ "$bind_addr" == "0.0.0.0" || "$bind_addr" == "*" || "$bind_addr" == "[::]" ]]; then
        if [[ "$port" != "22" && "$port" != "80" && "$port" != "443" && "$port" != "53" ]]; then
          log_finding "MEDIUM" "Ports" "Port $port ($desc) bound to $bind_addr — consider binding to 127.0.0.1"
        else
          echo "  OK    :$port ($desc) — bound to $bind_addr"
        fi
      else
        echo "  OK    :$port ($desc) — bound to $bind_addr"
      fi
    else
      log_finding "HIGH" "Ports" "Unexpected port $port open on $bind_addr — investigate process"
      echo "        $line"
      ((unexpected++))
    fi
  done < <(echo "$output" | tail -n +2)

  echo ""
  if [ "$unexpected" -eq 0 ]; then
    log_finding "PASS" "Ports" "No unexpected open ports detected"
  fi
}

cmd_ssl() {
  separator "SSL Certificate Check"

  local domains="${1:-$ALL_DOMAINS}"
  local now
  now=$(date +%s)

  for domain in $domains; do
    local expiry_str
    expiry_str=$(echo | timeout 5 openssl s_client -servername "$domain" -connect "$domain":443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)

    if [ -n "$expiry_str" ]; then
      local expiry_epoch
      expiry_epoch=$(date -d "$expiry_str" +%s 2>/dev/null || echo "0")
      local days_left=$(( (expiry_epoch - now) / 86400 ))

      if [ "$days_left" -lt 0 ]; then
        log_finding "CRITICAL" "SSL" "$domain certificate EXPIRED ($expiry_str)"
      elif [ "$days_left" -lt 7 ]; then
        log_finding "CRITICAL" "SSL" "$domain expires in $days_left days ($expiry_str)"
      elif [ "$days_left" -lt "$SSL_WARN_DAYS" ]; then
        log_finding "HIGH" "SSL" "$domain expires in $days_left days ($expiry_str)"
      else
        log_finding "PASS" "SSL" "$domain — $days_left days remaining"
      fi
    else
      log_finding "HIGH" "SSL" "$domain — could not connect or retrieve certificate"
    fi
  done
}

cmd_headers() {
  separator "HTTP Security Headers"

  local urls="${1:-}"

  if [ -z "$urls" ]; then
    # Build URLs from all domains
    urls=""
    for domain in $ALL_DOMAINS; do
      urls="$urls https://$domain"
    done
  fi

  for url in $urls; do
    # Ensure https prefix
    [[ "$url" == https://* ]] || url="https://$url"

    local domain
    domain=$(echo "$url" | sed 's|https://||' | cut -d/ -f1)

    echo "  Checking $domain..."
    local headers
    headers=$(curl -sI -m 10 "$url" 2>/dev/null | tr -d '\r')

    if [ -z "$headers" ]; then
      log_finding "HIGH" "Headers" "$domain — could not connect"
      continue
    fi

    local missing=()
    for hdr in "${SECURITY_HEADERS[@]}"; do
      if ! echo "$headers" | grep -qi "^${hdr}:"; then
        missing+=("$hdr")
      fi
    done

    if [ "${#missing[@]}" -eq 0 ]; then
      log_finding "PASS" "Headers" "$domain — all security headers present"
    elif [ "${#missing[@]}" -le 2 ]; then
      log_finding "LOW" "Headers" "$domain missing: ${missing[*]}"
    else
      log_finding "MEDIUM" "Headers" "$domain missing ${#missing[@]} headers: ${missing[*]}"
    fi
  done
}

cmd_deps() {
  separator "Dependency Audit"

  local target="${1:-}"
  local dirs=()

  if [ -n "$target" ]; then
    if [ -d "$target" ]; then
      dirs+=("$target")
    else
      echo "ERROR: Directory not found: $target"
      return 1
    fi
  else
    # Scan all project dirs
    for d in /root/projects/* /root/overlord; do
      [ -d "$d" ] && dirs+=("$d")
    done
  fi

  for dir in "${dirs[@]}"; do
    local name
    name=$(basename "$dir")

    if [ ! -f "$dir/package.json" ]; then
      continue
    fi

    # Check if node_modules or package-lock.json exist
    if [ ! -f "$dir/package-lock.json" ] && [ ! -d "$dir/node_modules" ]; then
      echo "  SKIP  $name — no package-lock.json or node_modules"
      continue
    fi

    echo "  Auditing $name..."
    local audit_output
    audit_output=$(cd "$dir" && npm audit --json 2>/dev/null || true)

    if [ -z "$audit_output" ]; then
      echo "  SKIP  $name — npm audit returned no output"
      continue
    fi

    local critical high moderate low total
    critical=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.critical // 0' 2>/dev/null || echo "0")
    high=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.high // 0' 2>/dev/null || echo "0")
    moderate=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.moderate // 0' 2>/dev/null || echo "0")
    low=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.low // 0' 2>/dev/null || echo "0")
    total=$(echo "$audit_output" | jq -r '.metadata.vulnerabilities.total // 0' 2>/dev/null || echo "0")

    if [ "$critical" -gt 0 ] 2>/dev/null; then
      log_finding "CRITICAL" "Deps" "$name — $critical critical, $high high, $moderate moderate vulnerabilities"
    elif [ "$high" -gt 0 ] 2>/dev/null; then
      log_finding "HIGH" "Deps" "$name — $high high, $moderate moderate vulnerabilities"
    elif [ "$moderate" -gt 0 ] 2>/dev/null; then
      log_finding "MEDIUM" "Deps" "$name — $moderate moderate, $low low vulnerabilities"
    elif [ "$total" -gt 0 ] 2>/dev/null; then
      log_finding "LOW" "Deps" "$name — $low low vulnerabilities"
    else
      log_finding "PASS" "Deps" "$name — no known vulnerabilities"
    fi
  done
}

cmd_docker() {
  separator "Docker Security Check"

  # Check for containers running as root
  echo "  Checking container users..."
  local containers
  containers=$(docker ps --format '{{.Names}}' 2>/dev/null)

  if [ -z "$containers" ]; then
    log_finding "HIGH" "Docker" "No running containers found or Docker not accessible"
    return
  fi

  local root_containers=()
  local privileged_containers=()
  local exposed_containers=()

  while IFS= read -r name; do
    [ -z "$name" ] && continue

    # Check if running as root
    local user
    user=$(docker inspect --format '{{.Config.User}}' "$name" 2>/dev/null || echo "")
    if [ -z "$user" ] || [ "$user" = "root" ] || [ "$user" = "0" ]; then
      root_containers+=("$name")
    fi

    # Check privileged mode
    local privileged
    privileged=$(docker inspect --format '{{.HostConfig.Privileged}}' "$name" 2>/dev/null || echo "false")
    if [ "$privileged" = "true" ]; then
      privileged_containers+=("$name")
    fi

    # Check for ports bound to 0.0.0.0 (excluding expected ones)
    local ports
    ports=$(docker inspect --format '{{range $p, $conf := .HostConfig.PortBindings}}{{range $conf}}{{.HostIp}}:{{.HostPort}} {{end}}{{end}}' "$name" 2>/dev/null || echo "")
    if echo "$ports" | grep -q "0.0.0.0"; then
      exposed_containers+=("$name=$ports")
    fi
  done <<< "$containers"

  # Report root containers (common in Docker, so LOW severity)
  if [ "${#root_containers[@]}" -gt 0 ]; then
    log_finding "LOW" "Docker" "${#root_containers[@]} container(s) running as root: ${root_containers[*]}"
  else
    log_finding "PASS" "Docker" "No containers running as root"
  fi

  # Report privileged containers (HIGH severity)
  if [ "${#privileged_containers[@]}" -gt 0 ]; then
    log_finding "HIGH" "Docker" "Privileged container(s): ${privileged_containers[*]}"
  else
    log_finding "PASS" "Docker" "No privileged containers"
  fi

  # Report exposed ports
  if [ "${#exposed_containers[@]}" -gt 0 ]; then
    for entry in "${exposed_containers[@]}"; do
      local cname="${entry%%=*}"
      local cports="${entry#*=}"
      log_finding "MEDIUM" "Docker" "$cname has ports on 0.0.0.0: $cports"
    done
  else
    log_finding "PASS" "Docker" "No containers with ports bound to 0.0.0.0"
  fi

  # Check image freshness
  echo ""
  echo "  Checking image freshness..."
  local old_images=0
  while IFS= read -r name; do
    [ -z "$name" ] && continue
    local created
    created=$(docker inspect --format '{{.Created}}' "$name" 2>/dev/null || continue)
    local created_epoch
    created_epoch=$(date -d "$created" +%s 2>/dev/null || continue)
    local now_epoch
    now_epoch=$(date +%s)
    local age_days=$(( (now_epoch - created_epoch) / 86400 ))

    if [ "$age_days" -gt 90 ]; then
      echo "    OLD   $name — image $age_days days old"
      ((old_images++))
    fi
  done <<< "$containers"

  if [ "$old_images" -gt 0 ]; then
    log_finding "LOW" "Docker" "$old_images container(s) with images older than 90 days"
  else
    log_finding "PASS" "Docker" "All container images created within 90 days"
  fi
}

cmd_fail2ban() {
  separator "Fail2ban Status"

  if ! command -v fail2ban-client &>/dev/null; then
    log_finding "HIGH" "Fail2ban" "fail2ban-client not found — is fail2ban installed?"
    return
  fi

  # Check if fail2ban is running
  local status
  status=$(systemctl is-active fail2ban 2>/dev/null || echo "inactive")
  if [ "$status" != "active" ]; then
    log_finding "CRITICAL" "Fail2ban" "Fail2ban is $status — not protecting the server"
    return
  fi

  log_finding "PASS" "Fail2ban" "Service is active"

  # Get jail list
  local jails
  jails=$(fail2ban-client status 2>/dev/null | grep "Jail list" | sed 's/.*://;s/,/ /g;s/^[ \t]*//')

  local expected_jails=("sshd" "traefik-auth" "traefik-botsearch" "traefik-ratelimit")
  for jail in "${expected_jails[@]}"; do
    if echo "$jails" | grep -qw "$jail"; then
      # Get jail stats
      local jail_status
      jail_status=$(fail2ban-client status "$jail" 2>/dev/null)
      local currently_banned
      currently_banned=$(echo "$jail_status" | grep "Currently banned" | awk '{print $NF}')
      local total_banned
      total_banned=$(echo "$jail_status" | grep "Total banned" | awk '{print $NF}')
      local currently_failed
      currently_failed=$(echo "$jail_status" | grep "Currently failed" | awk '{print $NF}')

      echo "  Jail: $jail — banned: $currently_banned (total: $total_banned), failed: $currently_failed"

      if [ "${currently_banned:-0}" -gt 10 ]; then
        log_finding "MEDIUM" "Fail2ban" "$jail has $currently_banned currently banned IPs — possible attack"
      fi
    else
      log_finding "HIGH" "Fail2ban" "Expected jail '$jail' is missing"
    fi
  done

  # Check for unexpected jails (info only)
  for jail in $jails; do
    local found=0
    for ej in "${expected_jails[@]}"; do
      [ "$jail" = "$ej" ] && found=1 && break
    done
    if [ "$found" -eq 0 ]; then
      echo "  INFO  Extra jail active: $jail"
    fi
  done

  # Show recently banned IPs
  echo ""
  echo "  Recent ban activity (last 50 lines of fail2ban log):"
  if [ -f /var/log/fail2ban.log ]; then
    local ban_lines
    ban_lines=$(grep -i "ban " /var/log/fail2ban.log 2>/dev/null | tail -5 || true)
    if [ -n "$ban_lines" ]; then
      echo "$ban_lines" | while IFS= read -r line; do
        echo "    $line"
      done
    else
      echo "    No recent ban activity in log"
    fi
  else
    echo "    No fail2ban log found at /var/log/fail2ban.log"
  fi
}

cmd_ssh() {
  separator "SSH Configuration Audit"

  local sshd_config="/etc/ssh/sshd_config"

  if [ ! -f "$sshd_config" ]; then
    log_finding "HIGH" "SSH" "sshd_config not found at $sshd_config"
    return
  fi

  # Resolve effective config (includes drop-in files)
  local effective
  effective=$(sshd -T 2>/dev/null || cat "$sshd_config")

  # Check password authentication
  local password_auth
  password_auth=$(echo "$effective" | grep -i "^passwordauthentication" | awk '{print $2}' | head -1)
  if [ "$password_auth" = "no" ]; then
    log_finding "PASS" "SSH" "Password authentication disabled"
  else
    log_finding "CRITICAL" "SSH" "Password authentication is enabled ($password_auth) — should be 'no'"
  fi

  # Check root login
  local permit_root
  permit_root=$(echo "$effective" | grep -i "^permitrootlogin" | awk '{print $2}' | head -1)
  if [ "$permit_root" = "no" ] || [ "$permit_root" = "prohibit-password" ] || [ "$permit_root" = "without-password" ]; then
    log_finding "PASS" "SSH" "Root login restricted ($permit_root)"
  elif [ "$permit_root" = "yes" ]; then
    log_finding "HIGH" "SSH" "Root login with password allowed — set to 'prohibit-password' or 'no'"
  else
    log_finding "LOW" "SSH" "PermitRootLogin = ${permit_root:-unset} — verify this is intentional"
  fi

  # Check pubkey authentication
  local pubkey_auth
  pubkey_auth=$(echo "$effective" | grep -i "^pubkeyauthentication" | awk '{print $2}' | head -1)
  if [ "$pubkey_auth" = "yes" ] || [ -z "$pubkey_auth" ]; then
    log_finding "PASS" "SSH" "Public key authentication enabled"
  else
    log_finding "HIGH" "SSH" "Public key authentication DISABLED — keys won't work"
  fi

  # Check for empty passwords
  local empty_pw
  empty_pw=$(echo "$effective" | grep -i "^permitemptypasswords" | awk '{print $2}' | head -1)
  if [ "$empty_pw" = "yes" ]; then
    log_finding "CRITICAL" "SSH" "Empty passwords PERMITTED"
  else
    log_finding "PASS" "SSH" "Empty passwords not permitted"
  fi

  # Check SSH port
  local ssh_port
  ssh_port=$(echo "$effective" | grep -i "^port " | awk '{print $2}' | head -1)
  if [ "${ssh_port:-22}" = "22" ]; then
    log_finding "LOW" "SSH" "Running on default port 22 — consider changing for obscurity"
  else
    log_finding "PASS" "SSH" "Running on non-default port $ssh_port"
  fi

  # Check MaxAuthTries
  local max_auth
  max_auth=$(echo "$effective" | grep -i "^maxauthtries" | awk '{print $2}' | head -1)
  if [ -n "$max_auth" ] && [ "$max_auth" -le 3 ] 2>/dev/null; then
    log_finding "PASS" "SSH" "MaxAuthTries = $max_auth"
  elif [ -n "$max_auth" ] && [ "$max_auth" -gt 6 ] 2>/dev/null; then
    log_finding "MEDIUM" "SSH" "MaxAuthTries = $max_auth — consider lowering to 3"
  fi

  # Check authorized_keys exist
  if [ -f /root/.ssh/authorized_keys ]; then
    local key_count
    key_count=$(grep -c "^ssh-" /root/.ssh/authorized_keys 2>/dev/null || echo "0")
    log_finding "PASS" "SSH" "$key_count authorized key(s) configured for root"
  else
    log_finding "HIGH" "SSH" "No authorized_keys file found for root"
  fi
}

cmd_env_files() {
  separator "Environment File Security"

  local bad_perms=0
  local git_exposed=0

  # Scan for .env files with wrong permissions
  echo "  Scanning for .env files..."
  while IFS= read -r envfile; do
    local perms
    perms=$(stat -c "%a" "$envfile" 2>/dev/null || echo "???")
    local owner
    owner=$(stat -c "%U" "$envfile" 2>/dev/null || echo "???")

    if [ "$perms" != "600" ]; then
      log_finding "HIGH" "Env" "$envfile has permissions $perms (should be 600)"
      ((bad_perms++))
    fi
  done < <(find /root/projects /root/overlord /data/coolify/applications -name ".env" -type f 2>/dev/null)

  if [ "$bad_perms" -eq 0 ]; then
    log_finding "PASS" "Env" "All .env files have correct permissions (600)"
  fi

  # Check git tracking of .env files
  echo ""
  echo "  Checking for .env files tracked by git..."
  for dir in /root/projects/* /root/overlord; do
    [ -d "$dir/.git" ] || continue
    local name
    name=$(basename "$dir")
    local tracked
    tracked=$(cd "$dir" && git ls-files --cached '*.env' '.env*' 2>/dev/null | grep -v '\.env\.example$' | grep -v '\.env\.sample$' | grep -v '\.env\.template$' || true)
    if [ -n "$tracked" ]; then
      log_finding "CRITICAL" "Env" "$name has .env tracked in git: $tracked"
      ((git_exposed++))
    fi
  done

  if [ "$git_exposed" -eq 0 ]; then
    log_finding "PASS" "Env" "No .env files tracked in any git repo"
  fi

  # Check .gitignore entries
  echo ""
  echo "  Checking .gitignore coverage..."
  for dir in /root/projects/* /root/overlord; do
    [ -d "$dir/.git" ] || continue
    local name
    name=$(basename "$dir")
    if [ -f "$dir/.gitignore" ]; then
      if ! grep -q "\.env" "$dir/.gitignore" 2>/dev/null; then
        log_finding "MEDIUM" "Env" "$name .gitignore does not mention .env"
      fi
    else
      log_finding "MEDIUM" "Env" "$name has no .gitignore file"
    fi
  done
}

cmd_full() {
  echo ""
  echo -e "${BOLD}========================================${NC}"
  echo -e "${BOLD}       Security Scan Report${NC}"
  echo -e "${BOLD}       $(date '+%Y-%m-%d %H:%M:%S')${NC}"
  echo -e "${BOLD}========================================${NC}"

  cmd_ports
  cmd_ssl
  cmd_headers
  cmd_deps
  cmd_docker
  cmd_fail2ban
  cmd_ssh
  cmd_env_files

  # Final summary
  echo ""
  echo -e "${BOLD}========================================${NC}"
  echo -e "${BOLD}              Summary${NC}"
  echo -e "${BOLD}========================================${NC}"
  echo ""

  local total_findings=$(( CRITICAL + HIGH + MEDIUM + LOW + PASS ))
  local total_issues=$(( CRITICAL + HIGH + MEDIUM + LOW ))

  if [ "$CRITICAL" -gt 0 ]; then
    echo -e "  ${RED}CRITICAL: $CRITICAL${NC}"
  fi
  if [ "$HIGH" -gt 0 ]; then
    echo -e "  ${RED}HIGH:     $HIGH${NC}"
  fi
  if [ "$MEDIUM" -gt 0 ]; then
    echo -e "  ${YELLOW}MEDIUM:   $MEDIUM${NC}"
  fi
  if [ "$LOW" -gt 0 ]; then
    echo -e "  ${CYAN}LOW:      $LOW${NC}"
  fi
  echo -e "  ${GREEN}PASS:     $PASS${NC}"
  echo ""
  echo "  Total findings: $total_findings ($total_issues issues, $PASS passed)"

  if [ "$CRITICAL" -gt 0 ]; then
    echo ""
    echo -e "  ${RED}ACTION REQUIRED: $CRITICAL critical issue(s) need immediate attention${NC}"
  fi

  echo ""
  echo "  Full report entries:"
  echo "  --------------------"
  for line in "${REPORT_LINES[@]}"; do
    echo "  $line"
  done

  echo ""
  echo "Summary: $CRITICAL critical, $HIGH high, $MEDIUM medium, $LOW low, $PASS pass"
}

# ── USAGE ─────────────────────────────────────────────────────────────────────

usage() {
  cat <<'USAGE'
security-scan.sh — Comprehensive security scanner

COMMANDS:
  ports                      Scan for open ports, flag unexpected ones
  ssl [domain]               Check SSL cert expiry (default: all domains)
  headers [url]              Check HTTP security headers
  deps [project_dir]         Run npm audit (default: all projects)
  docker                     Docker security: root, privileged, exposed ports
  fail2ban                   Fail2ban status: jails, bans, recent activity
  ssh                        SSH config audit: password auth, root login, keys
  env-files                  Check .env permissions and git exposure
  full                       Run ALL checks, generate summary report

DOMAINS CHECKED (ssl/headers):
  namibarden.com, beastmode.namibarden.com, lumina.namibarden.com,
  surfababe.namibarden.com, mastercommander.namibarden.com,
  onlyhulls.com, onlydrafting.com

EXAMPLES:
  security-scan.sh full
  security-scan.sh ports
  security-scan.sh ssl namibarden.com
  security-scan.sh headers https://beastmode.namibarden.com
  security-scan.sh deps /root/projects/BeastMode
  security-scan.sh fail2ban
USAGE
}

# ── MAIN ──────────────────────────────────────────────────────────────────────

cmd="${1:-help}"
shift 2>/dev/null || true

case "$cmd" in
  ports)      cmd_ports "$@" ;;
  ssl)        cmd_ssl "$@" ;;
  headers)    cmd_headers "$@" ;;
  deps)       cmd_deps "$@" ;;
  docker)     cmd_docker "$@" ;;
  fail2ban)   cmd_fail2ban "$@" ;;
  ssh)        cmd_ssh "$@" ;;
  env-files|env) cmd_env_files "$@" ;;
  full|all)   cmd_full "$@" ;;
  help|--help|-h) usage ;;
  *)
    echo "Unknown command: $cmd"
    echo "Run: security-scan.sh help"
    exit 1
    ;;
esac
