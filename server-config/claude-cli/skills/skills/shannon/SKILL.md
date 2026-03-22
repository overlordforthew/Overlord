---
name: shannon
description: "Security hygiene audit for web applications. Combines source code analysis with live runtime verification via Chrome DevTools. Checks 20 critical anti-patterns common in AI-generated/vibe-coded apps: rate limiting, auth token storage, input sanitisation, hardcoded keys, CORS, admin access, health endpoints, logging, TypeScript, and more. Use when user says 'shannon', 'security audit', 'hygiene check', 'audit <project>', or 'pentest'."
argument-hint: "<url> [project-path]"
allowed-tools:
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__take_snapshot
  - mcp__chrome-devtools__take_screenshot
  - mcp__chrome-devtools__evaluate_script
  - mcp__chrome-devtools__click
  - mcp__chrome-devtools__fill
  - mcp__chrome-devtools__emulate
  - mcp__chrome-devtools__list_console_messages
  - mcp__chrome-devtools__list_network_requests
  - mcp__chrome-devtools__lighthouse_audit
  - mcp__chrome-devtools__handle_dialog
  - mcp__chrome-devtools__press_key
  - mcp__chrome-devtools__select_page
  - mcp__chrome-devtools__list_pages
  - mcp__chrome-devtools__get_network_request
compatibility: Requires Chrome DevTools MCP server configured in Claude Code.
metadata:
  author: Gil Barden / Overlord
  version: "2026-03-21"
---

# Shannon — Application Security Hygiene Audit

20-point security audit combining **source code analysis** with **live runtime verification** via Chrome DevTools. Catches the antipatterns that sink vibe-coded apps.

## Prerequisites — MUST RUN FIRST

1. Verify Chrome DevTools MCP is available:

```
list_pages()
```

**If this fails**, STOP and tell the user:

> Chrome DevTools MCP is not connected. Add to `~/.claude.json` under `mcpServers`:
> ```json
> "chrome-devtools": {
>   "type": "stdio",
>   "command": "chrome-devtools-mcp",
>   "args": ["--headless", "--isolated", "--chromeArg=--no-sandbox", "--chromeArg=--disable-dev-shm-usage"]
> }
> ```
> Then: `npm install -g @anthropic-ai/chrome-devtools-mcp` and restart Claude Code.

2. Parse `$ARGUMENTS` for the target URL and optional project path. If only a URL is given, try to identify the project from the known projects list below. If only a project name is given, look up its URL.

**Known projects** (check `/root/projects/` for others):
| Project | Path | URL |
|---------|------|-----|
| NamiBarden | /root/projects/NamiBarden | https://namibarden.com |
| Lumina | /root/projects/Lumina | https://lumina.namibarden.com |
| SurfaBabe | /root/projects/SurfaBabe | https://surfababe.namibarden.com |
| MasterCommander | /root/projects/MasterCommander | https://mastercommander.namibarden.com |
| OnlyHulls | /root/projects/OnlyHulls | https://onlyhulls.com |
| Elmo | /root/projects/Elmo | https://onlydrafting.com |
| BeastMode | /root/projects/BeastMode | https://beastmode.namibarden.com |

## Execution Strategy

Run TWO parallel analysis tracks, then merge results:

**Track A — Runtime (Chrome DevTools):** Navigate to the live URL and verify security controls by actually testing them.

**Track B — Source Code (Read/Grep/Glob):** Analyze the project source for implementation details that can't be verified at runtime.

Use **subagents** (Agent tool) to parallelize: launch Track A and Track B simultaneously, then merge their findings into the final scorecard.

## Track A — Runtime Verification (Chrome DevTools)

Navigate to the target URL first:

```
navigate_page(url=<target>, type="url")
```

Then run these checks:

### A1. Rate Limiting Test

Hit the login/signup endpoint rapidly and check for 429 response:

```javascript
evaluate_script: async () => {
  const endpoints = ['/api/auth/login', '/api/login', '/auth/login', '/api/auth/signup'];
  const results = [];
  for (const ep of endpoints) {
    try {
      const responses = [];
      for (let i = 0; i < 15; i++) {
        const r = await fetch(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'test@test.com', password: 'test' })
        });
        responses.push(r.status);
        if (r.status === 429) break;
      }
      results.push({ endpoint: ep, statuses: responses, rateLimited: responses.includes(429) });
    } catch(e) { /* endpoint doesn't exist, skip */ }
  }
  return results;
}
```

**PASS** if any auth endpoint returns 429 after repeated requests. **FAIL** if all requests succeed without throttling.

### A2. CORS Policy Check

```javascript
evaluate_script: async () => {
  const r = await fetch(location.origin + '/api/', { method: 'OPTIONS' });
  const cors = r.headers.get('Access-Control-Allow-Origin');
  const methods = r.headers.get('Access-Control-Allow-Methods');
  return { cors, methods, wildcard: cors === '*' };
}
```

Also check the network requests tab for CORS headers on API calls:

```
list_network_requests()
```

**PASS** if CORS is restrictive (specific origin or absent). **FAIL** if wildcard `*` on authenticated endpoints.

### A3. Auth Token Storage Check

```javascript
evaluate_script: () => {
  const ls = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const val = localStorage.getItem(key);
    if (/token|auth|jwt|session|key/i.test(key) || /^eyJ/.test(val)) {
      ls[key] = val.substring(0, 50) + '...';
    }
  }
  const ss = {};
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    const val = sessionStorage.getItem(key);
    if (/token|auth|jwt|session|key/i.test(key) || /^eyJ/.test(val)) {
      ss[key] = val.substring(0, 50) + '...';
    }
  }
  const cookies = document.cookie;
  return {
    localStorage: ls,
    sessionStorage: ss,
    accessibleCookies: cookies || '(none — good, likely httpOnly)',
    hasTokenInStorage: Object.keys(ls).length > 0 || Object.keys(ss).length > 0
  };
}
```

**PASS** if no auth tokens in localStorage/sessionStorage. **FAIL** if JWT or auth tokens found in browser storage.

### A4. Health Check Endpoint

```javascript
evaluate_script: async () => {
  const paths = ['/health', '/healthz', '/api/health', '/status', '/api/status', '/ping'];
  const results = [];
  for (const p of paths) {
    try {
      const r = await fetch(p);
      if (r.ok) results.push({ path: p, status: r.status });
    } catch {}
  }
  return { found: results.length > 0, endpoints: results };
}
```

**PASS** if any health endpoint responds. **FAIL** if none found.

### A5. Hardcoded Keys in Frontend

```javascript
evaluate_script: () => {
  const scripts = document.querySelectorAll('script');
  const patterns = [
    /['"](sk_live_|sk_test_|pk_live_|pk_test_)[a-zA-Z0-9]+['"]/,
    /['"]AIza[a-zA-Z0-9_-]{35}['"]/,
    /['"]AKIA[A-Z0-9]{16}['"]/,
    /['"]ghp_[a-zA-Z0-9]{36}['"]/,
    /['"]postgres(ql)?:\/\/[^'"]+['"]/,
    /['"]mongodb(\+srv)?:\/\/[^'"]+['"]/,
  ];
  const findings = [];
  scripts.forEach(s => {
    if (s.src) return;
    const text = s.textContent;
    patterns.forEach(p => {
      const m = text.match(p);
      if (m) findings.push(m[0].substring(0, 30) + '...');
    });
  });
  const metas = document.querySelectorAll('meta[name*="key" i], meta[name*="token" i], meta[name*="secret" i]');
  metas.forEach(m => findings.push('meta: ' + m.name + '=' + (m.content || '').substring(0, 20)));
  return { found: findings.length > 0, findings };
}
```

**PASS** if no keys found. **FAIL** if any API keys, database URLs, or secrets in page source.

### A6. Console Errors

```
list_console_messages(types=["error"])
```

Note JS errors — they often indicate missing error boundaries or unhandled exceptions.

### A7. Admin Route Access Without Auth

```javascript
evaluate_script: async () => {
  const paths = ['/admin', '/api/admin', '/dashboard/admin', '/api/admin/users', '/api/admin/stats'];
  const results = [];
  for (const p of paths) {
    try {
      const r = await fetch(p);
      results.push({ path: p, status: r.status, accessible: r.status === 200 });
    } catch {}
  }
  return results;
}
```

**FAIL** if any admin endpoint returns 200 without authentication.

### A8. Static Asset CDN Check

```
list_network_requests()
```

Check where images, CSS, and JS are served from. If all static assets come from the app server (same origin, no CDN headers), mark as FAIL.

**PASS** if static assets served from CDN/S3/R2 (different hostname or CDN headers like `cf-cache-status`, `x-amz-*`).

### A9. Error Boundary Check (React/SPA)

```javascript
evaluate_script: () => {
  const hasReact = typeof window.__REACT_DEVTOOLS_GLOBAL_HOOK__ !== 'undefined' ||
                   document.querySelector('[data-reactroot]') !== null ||
                   document.querySelector('#__next') !== null;
  if (!hasReact) return { isReact: false, result: 'N/A' };
  const rootEl = document.querySelector('#root, #__next, [data-reactroot]');
  return { isReact: true, hasRoot: !!rootEl };
}
```

### A10. Session/Cookie Expiry Check

```javascript
evaluate_script: () => {
  const cookies = document.cookie.split(';').map(c => c.trim());
  return {
    visibleCookies: cookies.filter(c => c.length > 0),
    note: 'Check network tab for Set-Cookie headers with Max-Age/Expires'
  };
}
```

Also inspect network responses for Set-Cookie headers with expiry.

## Track B — Source Code Analysis (Read/Grep/Glob)

Use Glob and Grep to search the project source. Run these checks against the project path:

### B1. Rate Limiting Implementation
Search: `rate.limit|rateLimit|express-rate-limit|throttle|req.*per.*min`

### B2. Input Sanitisation
Search: `sanitize|escape|parameterized|prepared.*statement|\.query\(|sql\``
Check if database queries use parameterized queries or ORM. Look for raw string concatenation in SQL.

### B3. Stripe Webhook Verification
Search: `constructEvent|webhook.*secret|STRIPE_WEBHOOK_SECRET|stripe.*signature`
**N/A** if no Stripe integration found.

### B4. Session Expiry in Code
Search: `expiresIn|maxAge|exp.*claim|session.*timeout|cookie.*max`

### B5. Password Reset Token Expiry
Search: `reset.*expir|resetToken.*TTL|reset.*timeout|token.*expir`

### B6. Admin Role Checks
Search: `isAdmin|role.*admin|adminOnly|requireRole|requireAdmin|authorize`
Cross-reference with route definitions to verify middleware is applied.

### B7. Database Indexing
Search: `CREATE INDEX|\.index\(|ensureIndex|addIndex`
Check migration files and schema definitions.

### B8. Pagination
Search: `LIMIT|\.limit\(|offset|pagination|page.*param|cursor`

### B9. Connection Pooling
Search: `createPool|pool|connectionLimit|max.*connection|pgBouncer`

### B10. Environment Validation
Search: `validateEnv|required.*env|process\.exit.*env|missing.*env|\.env.*required`

### B11. CDN / Object Storage for Uploads
Search: `S3|R2|CloudFront|cloudinary|multer|upload.*path|writeFile.*upload`

### B12. Async Email Sending
Search: `bull|agenda|queue|worker|sendgrid|resend|background.*job|async.*email`

### B13. Structured Logging
Search: `pino|winston|bunyan|log4js|structured.*log|JSON.*log`

### B14. TypeScript Usage
Check for `tsconfig.json` and `.ts`/`.tsx` files.

### B15. Backup Strategy
Search: `pg_dump|backup|snapshot|WAL|replication|cron.*dump`
Check docker-compose.yml, scripts/, and cron configurations.

## Scoring & Report

After both tracks complete, merge results into a single scorecard.

### Grading Scale

| Grade | Pass Rate | Meaning |
|-------|-----------|---------|
| A | 18-20 PASS | Production-grade |
| B | 15-17 PASS | Solid with minor gaps |
| C | 12-14 PASS | Needs work before real traffic |
| D | 9-11 PASS | Significant risks |
| F | <9 PASS | Not ready for production |

### Report Format

```
## Shannon Security Hygiene Audit — [Project Name]
**URL:** [target URL]
**Source:** [project path]
**Date:** [today]

### Summary
| Total | PASS | FAIL | N/A | Grade |
|-------|------|------|-----|-------|
| 20    | X    | Y    | Z   | [A-F] |

### Scorecard

| # | Check | Result | Method | Evidence |
|---|-------|--------|--------|----------|
| 1 | Rate limiting on API routes | PASS/FAIL | Runtime+Code | [details] |
| 2 | Input sanitisation | PASS/FAIL | Code | [details] |
| 3 | CORS policy | PASS/FAIL | Runtime | [details] |
| 4 | Stripe webhook verification | PASS/FAIL/N/A | Code | [details] |
| 5 | Health check endpoint | PASS/FAIL | Runtime | [details] |
| 6 | Auth tokens NOT in localStorage | PASS/FAIL | Runtime | [details] |
| 7 | Sessions expire | PASS/FAIL | Runtime+Code | [details] |
| 8 | Password reset links expire | PASS/FAIL/N/A | Code | [details] |
| 9 | Admin routes have role checks | PASS/FAIL | Runtime+Code | [details] |
| 10 | Database indexing | PASS/FAIL | Code | [details] |
| 11 | Pagination on queries | PASS/FAIL | Code | [details] |
| 12 | Connection pooling | PASS/FAIL/N/A | Code | [details] |
| 13 | Backup strategy | PASS/FAIL | Code | [details] |
| 14 | No hardcoded keys in frontend | PASS/FAIL | Runtime | [details] |
| 15 | Env validation at startup | PASS/FAIL | Code | [details] |
| 16 | Error boundaries (React) | PASS/FAIL/N/A | Runtime+Code | [details] |
| 17 | Images via CDN/object storage | PASS/FAIL | Runtime | [details] |
| 18 | Emails sent async | PASS/FAIL/N/A | Code | [details] |
| 19 | Structured logging | PASS/FAIL | Code | [details] |
| 20 | TypeScript | PASS/FAIL | Code | [details] |

### Critical Findings (ranked by severity)

For each FAIL, provide:
- **What:** precise description
- **Where:** file:line or runtime evidence
- **Risk:** what happens if not fixed
- **Fix:** specific remediation (not generic advice)

### Strengths
[What the app does well — give credit for good practices]
```

## Full Shannon Pipeline

For a complete penetration test (injection, XSS, auth, SSRF, authz + the hygiene checks above), use the Shannon Docker pipeline:

```bash
cd /root/projects/shannon

# Symlink or clone the target repo
ln -s /root/projects/<ProjectName> ./repos/<project-name>

# Run full audit
./shannon start URL=<url> REPO=<project-name>

# Monitor progress
./shannon logs
# Temporal UI: http://localhost:8233
```

The full pipeline runs 6 parallel vulnerability agents (including hygiene), followed by conditional exploitation and executive reporting.

## Tips

- **Parallelize aggressively** — launch Track A (runtime) and Track B (code) as separate subagents
- **Don't over-report** — mark checks N/A when the feature doesn't exist (no Stripe = N/A on webhook verification)
- **Be fair** — if a defense is properly implemented, PASS it with evidence. The goal is accuracy, not finding failures
- **Screenshot on critical failure** — take a screenshot when finding something alarming (e.g., admin panel accessible without auth)
- **Check the actual framework** — Express, Next.js, Fastify, etc. have different patterns for rate limiting, CORS, etc. Adapt your grep patterns accordingly
