# Skill: DNS Manager

## Scope
Cloudflare DNS record management across all zones: namibarden.com, onlyhulls.com, onlydrafting.com.

## Script
`/root/overlord/skills/dns-manager/scripts/dns-manager.sh`

## Commands

| Command | Description |
|---------|-------------|
| `zones` | List all Cloudflare zones in the account |
| `list [domain]` | List all DNS records for a zone (default: namibarden.com) |
| `find <pattern>` | Search records by name pattern |
| `add <type> <name> <content> [--proxy]` | Add DNS record (A, AAAA, CNAME, TXT, MX) |
| `update <record_id> <content>` | Update existing record content |
| `delete <record_id> [--confirm]` | Delete a record (shows details first, requires --confirm) |
| `check <subdomain>` | Verify subdomain resolution (dig + curl + Cloudflare lookup) |
| `new-site <subdomain>` | Full workflow: create proxied A record + verify propagation |
| `ssl-status [domain]` | Check SSL/TLS settings for a zone |

## Dependencies
- `curl`, `jq`, `dig` (all pre-installed)
- Cloudflare credentials: `CLOUDFLARE_GLOBAL_API_KEY` and `CLOUDFLARE_EMAIL` in `/root/overlord/.env`

## Quick Examples
```bash
# List all records
dns-manager.sh list

# Add a proxied A record
dns-manager.sh add A myapp 5.78.82.169 --proxy

# Spin up a new subdomain
dns-manager.sh new-site myapp

# Search for records
dns-manager.sh find beastmode

# Check SSL
dns-manager.sh ssl-status
```

## Flags
- `--proxy` — Enable Cloudflare proxying (orange cloud) on add
- `--domain <d>` — Target a specific zone (default: namibarden.com)
- `--confirm` — Required to actually execute a delete
- `--ttl <n>` — Set TTL (default: 1 = auto)
- `--priority <n>` — Set MX priority
- `--no-proxy` — Disable proxying on update
