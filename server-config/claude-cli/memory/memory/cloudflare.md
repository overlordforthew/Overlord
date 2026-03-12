# CREDENTIALS  
- Token path: `/root/overlord/.env` (CLOUDFLARE_API_TOKEN)  
- Account ID: `099cbdaaadc71eef10329f795a4e564f`  
- Account: `Gilbarden@gmail.com`  
- Permissions: Zone/DNS SSL/PCache  
- Health check script: `/root/overlord/scripts/rotate-cf-token.sh` (cron quarterly)  

# ZONES  
- namibarden.com: `51ea8958dc949e1793c0d31435cfa699`  
- onlydrafting.com: `5a4473673d3df140fa184e36f8567031`  
- onlyhulls.com: `3d950be33832c344c40e7bd75a5c7ac2`  

# COMMON API  
- Auth: `{"Authorization": "Bearer $CLOUDFLARE_API_TOKEN", "Content-Type": "json"}`  
- LIST ZONES: `curl -s "https://api.cloudflare.com/client/v4/zones?account.id=..."`  
- LIST DNS: `curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records"`  
- CREATE RECORD: `curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" --data '{"type":"A","name":"...","content":"89.167.12.82","proxied":true}'`  
- CREATE CNAME: `curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" --data '{"type":"CNAME","name":"...","content":"..."}'`  

# NEW DOMAIN SETUP  
1. Get zone ID: `/zones?name=domain.com`  
2. Create A `89.167.12.82` (proxied) and CNAME `www → domain.com`  
3. Update COOLIFY DB: `UPDATE applications ...`  
4. Trigger deploy: `POST /api/v1/applications/{uuid}/restart`  
5. Verify: `curl -sI https://newdomain.com`  

# NOTES  
- A-records: proxied (T=1), TTL=1  
- Server: `89.167.12.82` (Hetzner CX33)
