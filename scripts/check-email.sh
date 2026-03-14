#!/bin/bash
# Overlord daily email check — scans inbox, notifies Gil via WhatsApp
# Runs via cron daily at 7am AST (11:00 UTC)

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/go/bin:$PATH"

WEBHOOK_TOKEN="7926de6ed6b692e8370b428fec47b202203f93870c0b9acf"
API="http://localhost:3001"

python3 << 'PYEOF'
import json, subprocess, sys, urllib.request

def gws(*args):
    r = subprocess.run(['gws'] + list(args), capture_output=True, text=True, timeout=30)
    if not r.stdout.strip():
        return {}
    return json.loads(r.stdout)

def send_whatsapp(msg):
    data = json.dumps({"to": "admin", "text": msg}).encode()
    req = urllib.request.Request(
        "http://localhost:3001/api/send",
        data=data,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer 7926de6ed6b692e8370b428fec47b202203f93870c0b9acf"
        }
    )
    try:
        urllib.request.urlopen(req, timeout=10)
    except:
        pass

# Check unread inbox
result = gws('gmail', 'users', 'messages', 'list',
    '--params', json.dumps({"userId": "me", "maxResults": 10, "q": "in:inbox is:unread -category:promotions -category:social"}))

msgs = result.get('messages', [])
if not msgs:
    sys.exit(0)

# Fetch details
lines = []
for m in msgs[:10]:
    try:
        md = gws('gmail', 'users', 'messages', 'get',
            '--params', json.dumps({"userId": "me", "id": m['id'], "format": "full"}))
        headers = {h['name']: h['value'] for h in md.get('payload',{}).get('headers',[])}
        sender = headers.get('From','?')[:50]
        subject = headers.get('Subject','(no subject)')[:80]
        snippet = md.get('snippet','')[:120]
        lines.append(f"• {sender}\n  {subject}\n  {snippet}")
    except:
        pass

if not lines:
    sys.exit(0)

count = len(lines)
summary = '\n\n'.join(lines)
msg = f"📧 {count} unread email(s):\n\n{summary}"
send_whatsapp(msg)
PYEOF
