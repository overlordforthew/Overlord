#!/bin/bash
# Overlord daily email check — scans inbox, notifies Gil via WhatsApp
# Runs via cron daily at 7am AST (11:00 UTC)
# Includes injection sanitization — all email content is untrusted

export PATH="/usr/local/bin:/usr/bin:/bin:/usr/local/go/bin:$PATH"

WEBHOOK_TOKEN="7926de6ed6b692e8370b428fec47b202203f93870c0b9acf"
API="http://localhost:3001"

python3 << 'PYEOF'
import json, re, subprocess, sys, urllib.request

# Injection patterns to strip from email content before forwarding
INJECTION_PATTERNS = [
    r'(?i)\b(ignore|disregard|forget)\b.{0,30}\b(previous|above|prior|all)\b.{0,30}\b(instructions?|prompts?|rules?)\b',
    r'(?i)\byou are now\b',
    r'(?i)\bact as\b.{0,20}\b(admin|root|system|assistant)\b',
    r'(?i)\bsystem\s*prompt\b',
    r'(?i)\b(execute|run|eval)\b.{0,20}\b(command|code|script|bash|shell)\b',
    r'(?i)<\s*/?(?:script|system|instruction|prompt)',
    r'(?i)\bnew instructions?\b',
    r'(?i)\boverride\b.{0,20}\b(instructions?|rules?|policy)\b',
    r'(?i)\bdo not follow\b',
    r'(?i)\brole:\s*system\b',
]

def sanitize_email_content(text):
    """Strip potential prompt injection from email content."""
    if not text:
        return text
    flagged = False
    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, text):
            flagged = True
            break
    if flagged:
        # Replace the content with a warning
        return "[EMAIL CONTENT REDACTED — potential injection detected]"
    # Also strip any XML/HTML-like tags that could confuse LLM context
    text = re.sub(r'<(system|instruction|prompt|role|context)[^>]*>.*?</\1>', '[redacted]', text, flags=re.IGNORECASE | re.DOTALL)
    return text

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
        subject = sanitize_email_content(headers.get('Subject','(no subject)')[:80])
        snippet = sanitize_email_content(md.get('snippet','')[:120])
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

echo "$(date -u '+%Y-%m-%d %H:%M UTC') — email check completed"
