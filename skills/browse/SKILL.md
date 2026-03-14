# Skill: Browse

## Scope
Fetch, digest, and inspect web pages using multiple browser engines (Lightpanda for speed, Chrome for full rendering).

## Available Tools

### browse.js
Fetch a URL and extract content using Lightpanda (fast headless) or Chrome (full rendering).

```bash
# Digest page to clean text (auto-selects fastest engine)
node /app/skills/browse/browse.js "https://example.com"

# Raw HTML output
node /app/skills/browse/browse.js "https://example.com" --html

# Extract all links
node /app/skills/browse/browse.js "https://example.com" --links

# JSON output (any mode)
node /app/skills/browse/browse.js "https://example.com" --json

# Force specific engine
node /app/skills/browse/browse.js "https://example.com" --engine lightpanda
node /app/skills/browse/browse.js "https://example.com" --engine chrome

# Run JavaScript on the page
node /app/skills/browse/browse.js "https://example.com" --eval "document.querySelectorAll('h1').length"

# Check which engines are available
node /app/skills/browse/browse.js --engines
```

### lib/browser.js (importable)
Shared browser module for other skills to import.

```javascript
import { getBrowser, fetchPage, digestPage, checkEngines } from '../../lib/browser.js';

// Quick digest
const { text, title, links } = await digestPage('https://example.com');

// Raw fetch
const { html, title } = await fetchPage('https://example.com', { engine: 'lightpanda' });

// Raw Puppeteer browser
const browser = await getBrowser('chrome');
const page = await browser.newPage();
// ... do whatever you need
```

## Engines

| Engine | Speed | JS Support | Best For |
|--------|-------|-----------|----------|
| Lightpanda | ~4x faster | Basic | Scraping, digesting, link extraction |
| Chrome | Baseline | Full | JS-heavy SPAs, screenshots, testing |
| auto | Fastest available | Varies | Default — tries Lightpanda first |

## When to Use
- User asks to "read a page", "check a site", "get content from", "digest", "browse"
- Need to extract text/links from a URL quickly
- Comparing how a page renders in different engines
- Need JS execution on a page (--eval)

## Notes
- Lightpanda is in Beta — some sites may not render fully. Use `--engine chrome` as fallback.
- For full site testing (forms, Lighthouse, mobile), use `/test-site` instead.
- For anti-bot/Cloudflare sites, use the scrapling skill instead.
