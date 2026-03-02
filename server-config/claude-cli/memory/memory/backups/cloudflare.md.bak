# Cloudflare API Reference

## Credentials
- **Token:** `CLOUDFLARE_API_TOKEN` in `/root/overlord/.env`
- **Account ID:** `099cbdaaadc71eef10329f795a4e564f`
- **Account:** Gilbarden@gmail.com
- **Permissions:** Zone DNS Edit, Zone Settings Edit, SSL/Certs Edit, Page Rules Edit, Zone Read, Analytics Read — All zones
- **Note:** Use account-scoped verify endpoint: `/client/v4/accounts/{account_id}/tokens/verify` (user-scoped `/client/v4/user/tokens/verify` returns invalid for this token type)

## Zones

| Domain | Zone ID | Status |
|--------|---------|--------|
| namibarden.com | 51ea8958dc949e1793c0d31435cfa699 | active |
| onlydrafting.com | 5a4473673d3df140fa184e36f8567031 | active |

## Common API Patterns

### Auth header
```
-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
-H "Content-Type: application/json"
```

### List zones
```bash
curl -s "https://api.cloudflare.com/client/v4/zones?account.id=$ACCOUNT_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### List DNS records for a zone
```bash
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $TOKEN"
```

### Create A record (proxied)
```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"A","name":"example.com","content":"89.167.12.82","ttl":1,"proxied":true}'
```

### Create CNAME (www → root)
```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"CNAME","name":"www","content":"example.com","ttl":1,"proxied":true}'
```

### Delete a DNS record
```bash
curl -s -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
  -H "Authorization: Bearer $TOKEN"
```

### Update a DNS record
```bash
curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"type":"A","name":"example.com","content":"89.167.12.82","ttl":1,"proxied":true}'
```

## New Domain Setup Workflow

1. **Get zone ID:** After domain is added to Cloudflare, query `/zones?name=domain.com`
2. **Create DNS records:**
   - A record for root (`domain.com`) → `89.167.12.82` (proxied)
   - CNAME for `www` → `domain.com` (proxied)
3. **Add to Coolify:**
   - Update FQDN in Coolify DB: `docker exec coolify-db psql -U coolify -c "UPDATE applications SET fqdn = 'https://existing.com,https://newdomain.com,https://www.newdomain.com' WHERE uuid = '...'"`
   - Clear custom_labels: `UPDATE applications SET custom_labels = NULL WHERE uuid = '...'`
   - Trigger redeploy via Coolify API: `POST /api/v1/applications/{uuid}/restart`
   - Coolify auto-generates Traefik labels with routers for all domains + Let's Encrypt certs
4. **Verify:** `curl -sI https://newdomain.com` should return 200

## Notes
- Cloudflare proxy (orange cloud) = traffic goes through CF edge, hides server IP, provides DDoS protection
- TTL=1 means "automatic" when proxied
- SSL mode should be "Full (strict)" since Traefik provides valid Let's Encrypt certs
- Server IP: `89.167.12.82` (Hetzner CX33)
