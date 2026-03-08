CREDENTIALS
- Token: `/root/overlord/.env` (CLOUDFLARE_API_TOKEN)
- Account ID: `099cbdaaadc71eef10329f795a4e564f`
- Account: `Gilbarden@gmail.com`
- Permissions: Zone/DNS Settings/SSL/PR/Eiated Cache
- Health check: `/root/overlord/scripts/rotate-cf-token.sh` (quarterly cron)

ZONES
- namibarden.com: `51ea8958dc949e1793c0d31435cfa699`
- onlydrafting.com: `5a4473673d3df140fa184e36f8567031`
- onlyhulls.com: `3d950be33832c344c40e7bd75a5c7ac2`

COMMON API
- Auth: `{"Authorization": "Bearer $CLOUDFLARE_API_TOKEN", "Content-Type": "json"}`
- LIST ZONES: `curl -s "https://api.cloudflare.com/client/v4/zones?account.id=..."`
- LIST DNS: `curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"`
- CREATE RECORD: `curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" --data '{"type":"A","name":"...","content":"89.167.12.82","proxied":true}'`
- UPDATE DNS: `curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" --data '{"type":"..."}'`
- CREATE CNAME: Similar to A record with `"type":"CNAME"`

NEW DOMAIN SETUP
1. GET ZONE ID: `/zones?name=domain.com`
2. CREATE A: `89.167.12.82` and CNAME: `www → domain.com`
3. UPDATE COOLIFY DB: `UPDATE applications ...`
4. TRIGGER DEPLOY: `POST /api/v1/applications/{uuid}/restart`
5. VERIFY: `200` from `curl -sI https://newdomain.com`

NOTES
- Proxied (orange cloud): hides IP, DDoS protection; TTL=1 when proxied
- Server: `89.167.12.82` (Hetzner CX33)
