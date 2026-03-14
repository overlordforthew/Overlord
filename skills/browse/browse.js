#!/usr/bin/env node
/**
 * browse.js — CLI tool for fetching/digesting pages via Lightpanda or Chrome.
 *
 * Usage:
 *   node browse.js <url>                          # Digest page (clean text)
 *   node browse.js <url> --html                   # Raw HTML
 *   node browse.js <url> --links                  # Extract links
 *   node browse.js <url> --json                   # JSON output
 *   node browse.js <url> --engine chrome           # Force Chrome
 *   node browse.js <url> --engine lightpanda       # Force Lightpanda
 *   node browse.js --engines                       # Check available engines
 *   node browse.js <url> --eval "document.title"   # Run JS on page
 */

import { getBrowser, fetchPage, digestPage, checkEngines } from '../../lib/browser.js';

const args = process.argv.slice(2);

if (args.includes('--engines')) {
  const engines = await checkEngines();
  console.log('Available browser engines:');
  console.log(`  Lightpanda: ${engines.lightpanda ? 'UP' : 'DOWN'}`);
  console.log(`  Chrome:     ${engines.chrome ? 'UP' : 'DOWN'}`);
  process.exit(0);
}

const url = args.find(a => a.startsWith('http'));
if (!url) {
  console.error('Usage: browse.js <url> [--html|--links|--json|--engine <name>|--eval "<js>"]');
  process.exit(1);
}

const flagIndex = (flag) => args.indexOf(flag);
const getFlag = (flag) => {
  const i = flagIndex(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const hasFlag = (flag) => args.includes(flag);

const engine = getFlag('--engine') || 'auto';
const asJson = hasFlag('--json');
const asHtml = hasFlag('--html');
const asLinks = hasFlag('--links');
const evalScript = getFlag('--eval');

try {
  if (evalScript) {
    // Run JS on the page and return the result
    const browser = await getBrowser(engine);
    const isLP = browser.wsEndpoint?.().includes('9222');
    try {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      const result = await page.evaluate(evalScript);
      console.log(asJson ? JSON.stringify(result, null, 2) : String(result));
      await page.close();
    } finally {
      if (isLP) await browser.disconnect();
      else await browser.close();
    }
  } else if (asHtml) {
    const result = await fetchPage(url, { engine });
    if (asJson) {
      console.log(JSON.stringify({ title: result.title, url: result.url, engine: result.engine, htmlLength: result.html.length, html: result.html }, null, 2));
    } else {
      console.log(result.html);
    }
  } else if (asLinks) {
    const result = await digestPage(url, { engine });
    if (asJson) {
      console.log(JSON.stringify({ title: result.title, url: result.url, engine: result.engine, links: result.links }, null, 2));
    } else {
      console.log(`${result.title} (${result.links.length} links, via ${result.engine})\n`);
      for (const link of result.links) {
        console.log(`  ${link.text.substring(0, 50).padEnd(52)} ${link.href}`);
      }
    }
  } else {
    // Default: digest
    const result = await digestPage(url, { engine, maxLength: 8000 });
    if (asJson) {
      console.log(JSON.stringify({ title: result.title, url: result.url, engine: result.engine, htmlLength: result.htmlLength, text: result.text, linkCount: result.links.length }, null, 2));
    } else {
      console.log(`[${result.engine}] ${result.title} (${result.htmlLength} chars HTML)\n`);
      console.log(result.text);
    }
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
