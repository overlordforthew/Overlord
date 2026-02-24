---
name: seo-audit
description: Comprehensive SEO audit for websites. Use when user asks to "audit SEO", "check SEO", "SEO review", "analyze SEO", or wants to improve a site's search engine optimization. Do NOT use for general web development tasks that don't involve SEO.
---

# SEO Audit Skill

You are an expert SEO auditor. When triggered, perform a thorough SEO audit of the target website or project.

## Workflow

### Step 1: Identify the Target
- Ask which project/site to audit if not specified
- Available projects: NamiBarden (namibarden.com), and any other sites in /projects/
- If a URL is provided, fetch it with WebFetch

### Step 2: Gather Data
Run these checks in parallel where possible:

**On-Page SEO (read HTML files directly):**
- Title tag: exists, length 50-60 chars, includes target keyword
- Meta description: exists, length 150-160 chars, compelling + keyword
- Canonical URL: present and correct
- H1: exactly one per page, contains primary keyword
- H2-H6: proper hierarchy, no skipped levels
- Image alt text: all images have descriptive alt attributes
- Internal links: check for broken anchors
- Open Graph tags: og:title, og:description, og:image, og:url, og:type
- Twitter Card: twitter:card, twitter:title, twitter:description, twitter:image
- Hreflang: present if multilingual
- Language attribute: html lang="" matches content

**Structured Data:**
- JSON-LD schema: present, valid type, required properties filled
- Check for Person, Organization, WebSite, BreadcrumbList as appropriate
- Validate against schema.org requirements

**Technical SEO (check config files + curl):**
- robots.txt: exists, allows important pages, blocks what it should
- sitemap.xml: exists, valid XML, all important URLs included, lastmod dates
- SSL/HTTPS: site accessible via HTTPS
- Server response codes: check for 404s, redirects
- Page speed indicators: file sizes, number of requests, render-blocking resources
- Mobile viewport meta tag present

**Server Config (nginx.conf or equivalent):**
- Gzip/Brotli compression enabled
- Cache headers configured (static assets ≥ 30d, HTML short/no-cache)
- Security headers: X-Frame-Options, X-Content-Type-Options, CSP, HSTS
- HTTP/2 enabled
- WWW/non-WWW redirect configured
- Trailing slash consistency

**Content Quality:**
- Word count: at least 300 words for main pages
- Keyword density: natural, not stuffed
- Readability: appropriate for audience
- Duplicate content risk: canonical tags in place

### Step 3: Live Checks (if site is deployed)
Use these commands to check the live site:
```bash
# Check HTTP headers
curl -sI https://DOMAIN | head -30

# Check robots.txt
curl -s https://DOMAIN/robots.txt

# Check sitemap
curl -s https://DOMAIN/sitemap.xml

# Check SSL cert
echo | openssl s_client -servername DOMAIN -connect DOMAIN:443 2>/dev/null | openssl x509 -noout -dates

# Check response time
curl -w "Connect: %{time_connect}s\nTTFB: %{time_starttransfer}s\nTotal: %{time_total}s\n" -o /dev/null -s https://DOMAIN

# Check redirect chain
curl -sIL https://DOMAIN 2>&1 | grep -E "HTTP/|Location:"

# Check mobile-friendliness (viewport)
curl -s https://DOMAIN | grep -i viewport
```

### Step 4: Score and Report
Rate each category on a scale:
- PASS: Meets best practices
- WARN: Works but could be improved
- FAIL: Missing or broken, needs fixing

Format the report for WhatsApp (no markdown headers, use emoji indicators):
- ✅ = PASS
- ⚠️ = WARN
- ❌ = FAIL

### Step 5: Action Items
Provide a prioritized list of fixes:
1. Critical (FAIL items) — fix immediately
2. Important (WARN items) — fix soon
3. Nice-to-have — future improvements

For each item, offer to implement the fix directly if it's a file we can edit.

## Output Format (WhatsApp-friendly)

```
🔍 *SEO AUDIT: [site name]*

📄 *On-Page*
✅ Title tag (58 chars)
✅ Meta description (155 chars)
❌ Missing og:image
⚠️ H1 could include target keyword

🏗️ *Technical*
✅ robots.txt configured
✅ sitemap.xml present
⚠️ No HSTS header
✅ Gzip enabled

📊 *Structured Data*
✅ JSON-LD Person schema
⚠️ Missing WebSite schema

⚡ *Performance*
✅ Compression: gzip level 6
✅ Static caching: 30 days
⚠️ No image optimization (WebP)

🔒 *Security*
✅ HTTPS active
✅ X-Frame-Options
❌ Missing Content-Security-Policy

*Score: 78/100*

*Top 3 Fixes:*
1. Add og:image for social sharing
2. Add Content-Security-Policy header
3. Convert images to WebP

Want me to implement any of these?
```

## Important Notes
- Always read the actual files before auditing — never guess
- Reference the SEO checklist in references/checklist.md for the full item list
- When fixing issues, make minimal targeted changes
- After fixes, re-run relevant checks to confirm
- Keep the report concise for WhatsApp — offer details on request
