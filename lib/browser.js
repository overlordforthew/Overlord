/**
 * browser.js — Unified browser abstraction for Lightpanda and Chrome.
 *
 * Usage:
 *   import { getBrowser, fetchPage, digestPage } from './lib/browser.js';
 *
 *   // Quick page fetch (auto-selects fastest available engine)
 *   const { html, title, url } = await fetchPage('https://example.com');
 *
 *   // Digest a page to clean markdown-like text
 *   const { text, title, links } = await digestPage('https://example.com');
 *
 *   // Get a raw Puppeteer browser instance
 *   const browser = await getBrowser('lightpanda'); // or 'chrome' or 'auto'
 */

import puppeteer from 'puppeteer-core';

const ENGINES = {
  lightpanda: {
    name: 'Lightpanda',
    connect: () => puppeteer.connect({ browserWSEndpoint: 'ws://lightpanda:9222/' }),
    connectLocal: () => puppeteer.connect({ browserWSEndpoint: 'ws://127.0.0.1:9222/' }),
  },
  chrome: {
    name: 'Chrome',
    launch: () => puppeteer.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      headless: 'new',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    }),
  },
};

/**
 * Get a Puppeteer browser instance.
 * @param {'lightpanda'|'chrome'|'auto'} engine
 * @returns {Promise<import('puppeteer-core').Browser>}
 */
export async function getBrowser(engine = 'auto') {
  if (engine === 'auto') {
    // Try Lightpanda first (faster), fall back to Chrome
    try {
      return await connectLightpanda();
    } catch {
      return await ENGINES.chrome.launch();
    }
  }

  if (engine === 'lightpanda') {
    return await connectLightpanda();
  }

  return await ENGINES.chrome.launch();
}

async function connectLightpanda() {
  // Try Docker network name first, then localhost
  try {
    return await ENGINES.lightpanda.connect();
  } catch {
    return await ENGINES.lightpanda.connectLocal();
  }
}

/**
 * Check which browser engines are available.
 * @returns {Promise<{lightpanda: boolean, chrome: boolean}>}
 */
export async function checkEngines() {
  const results = { lightpanda: false, chrome: false };

  try {
    const b = await connectLightpanda();
    await b.disconnect();
    results.lightpanda = true;
  } catch {}

  try {
    const b = await ENGINES.chrome.launch();
    await b.close();
    results.chrome = true;
  } catch {}

  return results;
}

/**
 * Fetch a page and return raw HTML + metadata.
 * @param {string} url
 * @param {object} opts
 * @param {'lightpanda'|'chrome'|'auto'} opts.engine
 * @param {number} opts.timeout - Navigation timeout in ms
 * @param {string} opts.waitUntil - Puppeteer waitUntil event
 * @returns {Promise<{html: string, title: string, url: string, engine: string}>}
 */
export async function fetchPage(url, opts = {}) {
  const { engine = 'auto', timeout = 15000, waitUntil = 'domcontentloaded' } = opts;
  const browser = await getBrowser(engine);
  const isLightpanda = engine === 'lightpanda' || (engine === 'auto' && browser.wsEndpoint?.().includes('9222'));

  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil, timeout });
    const html = await page.content();
    const title = await page.title().catch(() => '');
    const finalUrl = page.url();
    await page.close();

    return { html, title, url: finalUrl, engine: isLightpanda ? 'lightpanda' : 'chrome' };
  } finally {
    if (isLightpanda) await browser.disconnect();
    else await browser.close();
  }
}

/**
 * Digest a page into clean text, links, and metadata.
 * Uses Lightpanda for speed, falls back to Chrome for JS-heavy sites.
 * @param {string} url
 * @param {object} opts
 * @param {'lightpanda'|'chrome'|'auto'} opts.engine
 * @param {number} opts.maxLength - Max text length to return
 * @returns {Promise<{text: string, title: string, url: string, links: Array<{text: string, href: string}>, engine: string, htmlLength: number}>}
 */
export async function digestPage(url, opts = {}) {
  const { engine = 'auto', maxLength = 10000 } = opts;
  const { html, title, url: finalUrl, engine: usedEngine } = await fetchPage(url, { engine });

  // Extract clean text and links from HTML
  const { text, links } = extractContent(html, maxLength);

  return { text, title, url: finalUrl, links, engine: usedEngine, htmlLength: html.length };
}

/**
 * Extract clean text and links from HTML string.
 * Lightweight — no external DOM dependency needed since we already have the HTML.
 */
function extractContent(html, maxLength = 10000) {
  // Strip script, style, nav, footer, header tags and their content
  let clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Extract links before stripping tags
  const links = [];
  const linkRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[1];
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    if (href.startsWith('http') && text) {
      links.push({ text: text.substring(0, 100), href });
    }
  }

  // Strip remaining HTML tags, decode entities, collapse whitespace
  const text = clean
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, maxLength);

  return { text, links };
}
