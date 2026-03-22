#!/usr/bin/env bash
# gcloud-api.sh — Universal Google API helper
# Wraps OAuth token management + REST calls for ANY Google API
#
# Usage:
#   gcloud-api.sh token                              — Print current access token
#   gcloud-api.sh list-apis                           — List all enabled APIs
#   gcloud-api.sh enable <api>                        — Enable an API (e.g. vision.googleapis.com)
#   gcloud-api.sh disable <api>                       — Disable an API
#   gcloud-api.sh discover [filter]                   — List all available Google APIs
#   gcloud-api.sh call <URL> [method] [body]          — Call any Google API with OAuth
#   gcloud-api.sh call-key <URL>                      — Call any Google API with API key

set -o pipefail

PROJECT="overlord-488220"

# --- Token Management ---
get_token() {
    local EXPORT CLIENT_ID CLIENT_SECRET REFRESH_TOKEN RESP TOKEN
    EXPORT=$(gws auth export --unmasked 2>/dev/null)
    if [ -z "$EXPORT" ] || echo "$EXPORT" | grep -q '"error"'; then
        echo "ERROR: gws auth not working. Run: gws auth login --full" >&2
        return 1
    fi
    CLIENT_ID=$(echo "$EXPORT" | python3 -c "import json,sys; print(json.load(sys.stdin)['client_id'])")
    CLIENT_SECRET=$(echo "$EXPORT" | python3 -c "import json,sys; print(json.load(sys.stdin)['client_secret'])")
    REFRESH_TOKEN=$(echo "$EXPORT" | python3 -c "import json,sys; print(json.load(sys.stdin)['refresh_token'])")
    
    RESP=$(curl -s -X POST "https://oauth2.googleapis.com/token" \
        -d "client_id=$CLIENT_ID" \
        -d "client_secret=$CLIENT_SECRET" \
        -d "refresh_token=$REFRESH_TOKEN" \
        -d "grant_type=refresh_token")
    
    TOKEN=$(echo "$RESP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
    if [ -z "$TOKEN" ]; then
        echo "ERROR: Token refresh failed — $(echo "$RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('error_description', d.get('error','unknown')))" 2>/dev/null)" >&2
        return 1
    fi
    echo "$TOKEN"
}

get_api_key() {
    source /root/overlord/.env 2>/dev/null
    echo "${GOOGLE_API_KEY:-}"
}

# --- Commands ---
case "${1:-help}" in
    token)
        get_token
        ;;
    
    list-apis)
        TOKEN=$(get_token) || exit 1
        curl -s -H "Authorization: Bearer $TOKEN" \
            "https://serviceusage.googleapis.com/v1/projects/$PROJECT/services?filter=state:ENABLED&pageSize=200" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'services' in d:
    for svc in sorted(d['services'], key=lambda s: s.get('config',{}).get('title','')):
        name = svc.get('config', {}).get('name', 'unknown')
        title = svc.get('config', {}).get('title', '')
        print(f'  [{\"ON\":5}] {title}: {name}')
    print(f'\nTotal: {len(d[\"services\"])} APIs enabled on project $PROJECT')
elif 'error' in d:
    code = d['error'].get('code','')
    msg = d['error'].get('message','')
    if '403' in str(code) or 'scope' in msg.lower():
        print('ERROR: Need cloud-platform scope. Re-auth with: gws auth login --full')
    else:
        print(f'Error: {msg}')
"
        ;;
    
    enable)
        [ -z "$2" ] && echo "Usage: $0 enable <api-name>" && echo "Example: $0 enable vision.googleapis.com" && exit 1
        TOKEN=$(get_token) || exit 1
        echo "Enabling $2 on project $PROJECT..."
        curl -s -X POST -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            "https://serviceusage.googleapis.com/v1/projects/$PROJECT/services/$2:enable" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'name' in d:
    print(f'OK: $2 is being enabled (operation: {d[\"name\"]})')
    print('Note: May take a few minutes to propagate.')
elif 'error' in d:
    print(f'Error: {d[\"error\"].get(\"message\",\"unknown\")}')
else:
    print(json.dumps(d, indent=2))
"
        ;;
    
    disable)
        [ -z "$2" ] && echo "Usage: $0 disable <api-name>" && echo "Example: $0 disable vision.googleapis.com" && exit 1
        TOKEN=$(get_token) || exit 1
        echo "Disabling $2 on project $PROJECT..."
        curl -s -X POST -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            "https://serviceusage.googleapis.com/v1/projects/$PROJECT/services/$2:disable" | python3 -c "
import json, sys
d = json.load(sys.stdin)
if 'name' in d:
    print(f'OK: $2 is being disabled')
elif 'error' in d:
    print(f'Error: {d[\"error\"].get(\"message\",\"unknown\")}')
else:
    print(json.dumps(d, indent=2))
"
        ;;
    
    discover)
        FILTER="${2:-}"
        echo "Available Google APIs:"
        curl -s "https://www.googleapis.com/discovery/v1/apis" | python3 -c "
import json, sys
d = json.load(sys.stdin)
items = d.get('items', [])
seen = set()
for api in sorted(items, key=lambda x: x.get('title','')):
    name = api.get('name','')
    title = api.get('title','')
    version = api.get('version','')
    desc = api.get('description','')[:80]
    key = name
    if key in seen:
        continue
    seen.add(key)
    filt = '$FILTER'.lower()
    if filt and filt not in name.lower() and filt not in title.lower() and filt not in desc.lower():
        continue
    print(f'  {title} ({name} {version})')
    print(f'    {desc}')
    print()
print(f'Showing {len(seen)} APIs' + (' matching \"$FILTER\"' if '$FILTER' else ''))
"
        ;;
    
    call)
        [ -z "$2" ] && echo "Usage: $0 call <URL> [GET|POST|PATCH|DELETE] [JSON-body]" && exit 1
        TOKEN=$(get_token) || exit 1
        URL="$2"
        METHOD="${3:-GET}"
        BODY="${4:-}"
        
        if [ -n "$BODY" ]; then
            curl -s -X "$METHOD" -H "Authorization: Bearer $TOKEN" \
                -H "Content-Type: application/json" \
                -d "$BODY" "$URL"
        else
            curl -s -X "$METHOD" -H "Authorization: Bearer $TOKEN" "$URL"
        fi
        ;;
    
    call-key)
        [ -z "$2" ] && echo "Usage: $0 call-key <URL>" && exit 1
        GKEY=$(get_api_key)
        [ -z "$GKEY" ] && echo "ERROR: No GOOGLE_API_KEY in /root/overlord/.env" && exit 1
        
        # Append key to URL
        if echo "$2" | grep -q '?'; then
            curl -s "$2&key=$GKEY"
        else
            curl -s "$2?key=$GKEY"
        fi
        ;;
    
    help|*)
        cat << 'USAGE'
gcloud-api.sh — Universal Google API helper

Commands:
  token                         Get OAuth access token
  list-apis                     List enabled APIs on project
  enable <api.googleapis.com>   Enable an API
  disable <api.googleapis.com>  Disable an API
  discover [filter]             Search available Google APIs
  call <url> [method] [body]    Call any API with OAuth token
  call-key <url>                Call any API with API key

Examples:
  gcloud-api.sh list-apis
  gcloud-api.sh enable vision.googleapis.com
  gcloud-api.sh discover youtube
  gcloud-api.sh call "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true"
  gcloud-api.sh call-key "https://generativelanguage.googleapis.com/v1beta/models"
USAGE
        ;;
esac
