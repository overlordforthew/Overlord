---
name: test-site
description: Run a comprehensive functional test suite on any website using Chrome DevTools MCP. Tests page rendering, images, links, forms, navigation, mobile responsive, console errors, network failures, and Lighthouse (accessibility, SEO, best practices). Use when user says "test site", "test fully", "functional test", "test <url>", "QA check", or "smoke test".
argument-hint: <url>
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
compatibility: Requires Chrome DevTools MCP server configured in Claude Code.
metadata:
  author: Gil Barden / Overlord
  version: "2026-03-14"
---

# Test Site

Comprehensive functional test suite for any website using Chrome DevTools MCP.

## Prerequisites — MUST RUN FIRST

Before running any tests, verify Chrome DevTools MCP is available by calling:

```
list_pages()
```

**If this fails or the tool is not found**, STOP immediately and tell the user:

---

**Chrome DevTools MCP is not connected.** This skill requires the `chrome-devtools` MCP server.

**To enable it**, add this to your `~/.claude.json` under `mcpServers`:

```json
"chrome-devtools": {
  "type": "stdio",
  "command": "chrome-devtools-mcp",
  "args": ["--headless", "--isolated", "--chromeArg=--no-sandbox", "--chromeArg=--disable-dev-shm-usage"]
}
```

Then install the binary if missing: `npm install -g @anthropic-ai/chrome-devtools-mcp`

Restart Claude Code after adding the config.

---

Do NOT proceed with any tests if the MCP check fails.

## Instructions

Given a URL (from `$ARGUMENTS` or the user), execute the full test suite below. Adapt tests to the site's actual content — skip tests that don't apply (e.g., skip form test if no forms exist).

### Step 1: Navigate and Verify Homepage

```
navigate_page(url=<target>, type="url")
take_snapshot()
```

- Confirm page loads (non-empty snapshot, has heading or main content)
- Record the page title
- **PASS** if content renders. **FAIL** if blank or error page.

### Step 2: Image Audit

```
evaluate_script: () => {
  const imgs = document.querySelectorAll('img');
  const results = [];
  imgs.forEach(img => {
    results.push({
      src: img.src,
      alt: img.alt,
      loaded: img.naturalWidth > 0,
      width: img.naturalWidth,
      height: img.naturalHeight
    });
  });
  return { total: results.length, broken: results.filter(i => !i.loaded), missingAlt: results.filter(i => !i.alt) };
}
```

- Report total images, broken images (naturalWidth === 0), missing alt text
- **PASS** if zero broken. Note missing alt as accessibility warning.

### Step 3: Internal Link Check

```
evaluate_script: () => {
  const origin = location.origin;
  const links = [...document.querySelectorAll('a[href]')]
    .map(a => a.href)
    .filter(h => h.startsWith(origin) || h.startsWith('/'))
    .filter(h => !h.includes('#') || h.split('#')[0] !== location.href.split('#')[0]);
  return [...new Set(links)];
}
```

For each unique internal link (deduplicated, limit to 20):

```
evaluate_script: async (url) => {
  const r = await fetch(url, { method: 'HEAD' });
  return { url, status: r.status, ok: r.ok };
}
```

- **PASS** if all return 200. **FAIL** with list of non-200 URLs.

### Step 4: Form Testing

From the snapshot, identify all forms (textbox, button elements). For each form:

1. **Empty submission test** — click submit without filling fields. Check for validation messages or alerts.
2. **Filled submission test** — fill required fields with test data, submit. Check for success feedback.

Handle `alert()` dialogs: use `handle_dialog` to accept/dismiss, and if needed override `window.alert` via evaluate_script before triggering submit.

- **PASS** if validation works on empty submit and form responds to valid input.
- **SKIP** if no forms found.

### Step 5: Navigation / Multi-Page Check

From the snapshot, identify nav links to other pages (portfolio, about, estimator, dashboard, etc.). Navigate to each (limit 5) and take a snapshot to confirm rendering.

- **PASS** if all pages render content. **FAIL** if any returns blank/error.

### Step 6: Interactive Features

Test site-specific interactive elements found in the snapshot:

- **Wizards/multi-step flows** — click through each step, verify progression
- **Login forms** — test with demo credentials if provided on the page
- **Tabs/accordions** — click and verify content toggles
- **Chat widgets** — verify presence and WhatsApp/contact links
- **Modals** — click triggers and verify they open

Adapt to what exists on the site. Skip if no interactive elements found.

### Step 7: Mobile Responsive

```
emulate(viewport="375x812x3,mobile,touch")
navigate_page(url=<target>, type="url")
take_screenshot()
```

- Verify layout doesn't break (no horizontal overflow, text readable)
- Check for hamburger menu — if found, click it and verify nav opens

```
emulate(viewport="1280x800x1")  // Reset to desktop
```

- **PASS** if mobile layout renders correctly.

### Step 8: Console Errors

```
list_console_messages(types=["error", "warn"])
```

- **PASS** if zero errors. Note warnings but don't fail for them.
- **FAIL** if JS errors present — list each.

### Step 9: Network Failures

```
list_network_requests()
```

- Check for any non-2xx responses (ignore 3xx redirects)
- **PASS** if all resources load successfully. **FAIL** with list of failed requests.

### Step 10: External Links (Quick Check)

```
evaluate_script: () => {
  const origin = location.origin;
  return [...new Set(
    [...document.querySelectorAll('a[href^="http"]')]
      .map(a => a.href)
      .filter(h => !h.startsWith(origin))
  )];
}
```

Report external links found. Do NOT fetch them (avoid rate limits/blocks). Just list for manual review.

### Step 11: Lighthouse Audit

```
lighthouse_audit(device="desktop", mode="navigation")
```

Report scores for:
- Accessibility (target: 90+)
- Best Practices (target: 90+)
- SEO (target: 90+)

Note: Lighthouse via MCP excludes Performance. For performance audits, use `performance_start_trace` / `performance_stop_trace` separately.

## Report Format

After all tests complete, present a summary table:

```
| # | Test | Result |
|---|------|--------|
| 1 | Homepage renders | PASS/FAIL |
| 2 | Images (X total, Y broken) | PASS/FAIL |
| 3 | Internal links (X checked) | PASS/FAIL |
| 4 | Form validation | PASS/FAIL/SKIP |
| 5 | Multi-page navigation | PASS/FAIL |
| 6 | Interactive features | PASS/FAIL/SKIP |
| 7 | Mobile responsive | PASS/FAIL |
| 8 | Console errors | PASS/FAIL |
| 9 | Network requests | PASS/FAIL |
| 10 | External links | X found (listed) |
| 11 | Lighthouse: Accessibility | score |
| 12 | Lighthouse: Best Practices | score |
| 13 | Lighthouse: SEO | score |
```

End with:
- **Issues found** — list any failures with details
- **Recommendations** — actionable fixes for failures
- **Overall verdict** — PASS (all green) / NEEDS WORK (has failures)

## Tips

- **Parallelize where possible** — independent checks (console + network) can run together
- **Adapt to the site** — not every site has forms, wizards, or login. Test what exists.
- **Handle dialogs** — some forms use `alert()`. Override with `window.alert = (msg) => { window._lastAlert = msg; }` before triggering, then read `window._lastAlert`.
- **Rate limit** — don't hammer the site. One request at a time for link checks.
- **Screenshot on failure** — if a test fails, take a screenshot for evidence.

## Integration with Shannon

This skill tests functional correctness. For security testing, use Shannon:

```bash
cd /root/projects/shannon
./shannon start URL=<url> REPO=<name>
```

Recommended workflow:
1. `/test-site <url>` — verify the site works correctly
2. `./shannon start URL=<url>` — security audit
3. Fix issues from both, re-run `/test-site` to confirm fixes
