# SEO Audit Checklist — Full Reference

## 1. On-Page SEO (45 points total)

### Title Tag (5 pts)
- [ ] Exists on every page
- [ ] 50-60 characters (Google truncates at ~60)
- [ ] Unique per page
- [ ] Contains primary keyword near the beginning
- [ ] Compelling/click-worthy (not just keyword stuffing)

### Meta Description (5 pts)
- [ ] Exists on every page
- [ ] 150-160 characters
- [ ] Unique per page
- [ ] Contains primary keyword naturally
- [ ] Includes a call-to-action or value proposition

### Heading Structure (5 pts)
- [ ] Exactly ONE H1 per page
- [ ] H1 contains primary keyword
- [ ] H2-H6 follow proper hierarchy (no skipped levels)
- [ ] Headings are descriptive, not generic ("About" → "About Nami Barden")
- [ ] No headings used purely for styling

### URL Structure (3 pts)
- [ ] Clean, readable URLs (no ?id=123&session=abc)
- [ ] Hyphens not underscores
- [ ] Lowercase
- [ ] Contains relevant keyword
- [ ] No unnecessary depth (/blog/post not /blog/2024/01/15/category/post)

### Images (5 pts)
- [ ] All images have descriptive alt text
- [ ] Alt text includes keywords where natural
- [ ] Images compressed (WebP preferred, JPEG for photos, PNG for transparency)
- [ ] Lazy loading on below-fold images (loading="lazy")
- [ ] Width/height attributes set (prevents CLS)
- [ ] Responsive images (srcset for different sizes)

### Internal Linking (3 pts)
- [ ] Key pages linked from navigation
- [ ] Descriptive anchor text (not "click here")
- [ ] No broken internal links
- [ ] Reasonable link depth (important pages ≤ 3 clicks from home)

### Content Quality (5 pts)
- [ ] Minimum 300 words on main pages
- [ ] Natural keyword usage (not stuffed)
- [ ] Readable: short paragraphs, bullet points, subheadings
- [ ] Unique content (not duplicated from elsewhere)
- [ ] Updated/fresh (check dates if applicable)

### Open Graph (5 pts)
- [ ] og:title — page title
- [ ] og:description — compelling summary
- [ ] og:image — high quality, 1200x630px ideal
- [ ] og:url — canonical URL
- [ ] og:type — website, article, etc.
- [ ] og:site_name — brand name
- [ ] og:locale — language_TERRITORY

### Twitter Card (4 pts)
- [ ] twitter:card — summary or summary_large_image
- [ ] twitter:title
- [ ] twitter:description
- [ ] twitter:image
- [ ] twitter:site — @handle if applicable

### Internationalization (5 pts)
- [ ] html lang attribute matches content language
- [ ] hreflang tags for all language versions
- [ ] x-default hreflang for fallback
- [ ] Content-Language HTTP header matches
- [ ] Proper character encoding (UTF-8)

## 2. Technical SEO (30 points total)

### Crawlability (8 pts)
- [ ] robots.txt exists at domain root
- [ ] robots.txt allows important pages
- [ ] robots.txt blocks admin/private areas
- [ ] robots.txt points to sitemap(s)
- [ ] No accidental noindex on important pages
- [ ] XML sitemap exists and is valid
- [ ] Sitemap includes all important URLs
- [ ] Sitemap has accurate lastmod dates
- [ ] Sitemap submitted to Google Search Console

### SSL/HTTPS (4 pts)
- [ ] Valid SSL certificate
- [ ] Certificate not expiring within 30 days
- [ ] HTTP → HTTPS redirect in place
- [ ] No mixed content (HTTP resources on HTTPS page)
- [ ] HSTS header configured

### Mobile (4 pts)
- [ ] Viewport meta tag present and correct
- [ ] Responsive design (no horizontal scroll)
- [ ] Touch targets ≥ 48x48px
- [ ] Text readable without zoom (≥ 16px)
- [ ] No Flash or deprecated tech

### Performance (8 pts)
- [ ] Page load time < 3 seconds
- [ ] TTFB < 600ms
- [ ] Gzip or Brotli compression enabled
- [ ] CSS/JS minified
- [ ] Critical CSS inlined or preloaded
- [ ] Fonts preloaded or font-display: swap
- [ ] Static assets cached (≥ 30 days)
- [ ] Images optimized (WebP, proper sizing)
- [ ] No render-blocking resources in head
- [ ] HTTP/2 or HTTP/3 enabled

### Redirects & Errors (3 pts)
- [ ] No redirect chains (A → B → C; should be A → C)
- [ ] No redirect loops
- [ ] Custom 404 page exists
- [ ] No soft 404s (empty pages returning 200)
- [ ] WWW/non-WWW canonical redirect

### Structured Data (3 pts)
- [ ] JSON-LD format (preferred over Microdata/RDFa)
- [ ] Valid schema matching page type
- [ ] Required properties filled (name, url, description)
- [ ] No errors in Google Rich Results Test
- [ ] Appropriate types: Person, Organization, WebSite, Article, Product, FAQ, etc.

## 3. Security Headers (10 points total)
- [ ] X-Frame-Options: SAMEORIGIN or DENY (2 pts)
- [ ] X-Content-Type-Options: nosniff (2 pts)
- [ ] Content-Security-Policy: configured (2 pts)
- [ ] Strict-Transport-Security (HSTS) (2 pts)
- [ ] Referrer-Policy: strict-origin-when-cross-origin (1 pt)
- [ ] Permissions-Policy: restrict unused APIs (1 pt)

## 4. Server Configuration (10 points total)
- [ ] Compression: gzip level 6+ or Brotli (3 pts)
- [ ] Cache-Control headers properly set (2 pts)
- [ ] ETag or Last-Modified for cache validation (1 pt)
- [ ] Keep-alive connections enabled (1 pt)
- [ ] Proper MIME types for all served files (1 pt)
- [ ] Error pages configured (404, 500) (1 pt)
- [ ] Access logs and error logs enabled (1 pt)

## 5. Off-Page / External (5 points — check only, can't fix)
- [ ] Google Search Console connected
- [ ] Google Analytics or equivalent tracking
- [ ] Site submitted to Google/Bing
- [ ] Social profiles linked
- [ ] Business listings consistent (if local)

## Scoring Guide
- 90-100: Excellent — minor tweaks only
- 75-89: Good — a few important fixes
- 60-74: Fair — several issues to address
- 40-59: Needs Work — significant gaps
- Below 40: Critical — major SEO overhaul needed
