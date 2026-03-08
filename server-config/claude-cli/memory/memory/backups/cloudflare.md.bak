

CLOUDFLARE API REFERENCE
CREDENTIALS
- Token: `CLOUDFLARE_API_TOKEN` in `/root/overlord/.env`
- Account ID: `099cbdaaadc71eef10329f795a4e564f`
- Account: Gilbarden@gmail.com
- Token ID: `5aa57ca0c6ae27710079094badd19659`
- Permissions: Zone Read/Edit, DNS Edit, Zone Settings Read, SSL/Certs Edit, Page Rules Edit, Cache Purge, Account Settings Read
- Health check: `/root/overlord/scripts/rotate-cf-token.sh` runs quarterly via cron

ZONES
| Domain | Zone ID | Status |
|--------|---------|--------|
| namibarden.com | 51ea8958dc949e1793c0d31435cfa699 | active |
| onlydrafting.com | 5a4473673d3df140fa184e36f8567031 | active |
| onlyhulls.com | 3d950be33832c344c40e7bd75a5c7ac2 | active |

COMMON API PATTERNS
AUTH: `-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"` `-H "Content-Type: application/json"`

LIST ZONES
`curl -s "https://api.cloudflare.com/client/v4/zones?account.id=$ACCOUNT_ID"`

LIST DNS
`curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"`

CREATE A RECORD
`curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" --data '{"type":"A","name":"example.com","content":"89.167.12.82","proxied":true}'`

CREATE CNAME
`curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" --data '{"type":"CNAME","name":"www","content":"example.com","proxied":true}'`

DELETE DNS
`curl -s -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID"`

UPDATE DNS
`curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" --data '{"type":"A","name":"example.com","content":"89.167.12.82","proxied":true}'`

NEW DOMAIN SETUP
1. GET ZONE ID: `/zones?name=domain.com`
2. CREATE A RECORD (`domain.com` → `89.167.12.82`) and CNAME (`www` → `domain.com`)
3. UPDATE COOLIFY DB: `UPDATE applications SET fqdn = 'https://existing.com,https://newdomain.com,https://www.newdomain.com' WHERE uuid = '...'`; `UPDATE applications SET custom_labels = NULL WHERE uuid = '...'`
4. TRIGGER DEPLOY: `POST /api/v1/applications/{uuid}/restart`
5. VERIFY: `curl -sI https://newdomain.com` → 200

NOTES
- Orange cloud = Cloudflare proxy (hides server IP, DDoS protection)
- TTL=1 = automatic when proxied
- Server IP: `89.167.12.82` (Hetzner CX33)
