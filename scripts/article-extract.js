#!/usr/bin/env node
/**
 * Article Extractor using Mozilla Readability
 *
 * Extracts clean article text from any URL using Readability + JSDOM.
 * Falls back to Cheerio-based segment extraction if Readability fails.
 *
 * Usage: node article-extract.js <url>
 * Returns: JSON { title, content, excerpt, byline, siteName, method }
 */

import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import * as cheerio from 'cheerio';
import https from 'https';
import http from 'http';

const url = process.argv[2];

if (!url) {
  console.error('Usage: node article-extract.js <url>');
  process.exit(1);
}

// Fetch URL with redirect following
function fetchUrl(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirect = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).toString();
        return fetchUrl(redirect, maxRedirects - 1).then(resolve, reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ html: data, statusCode: res.statusCode }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Strategy 1: Mozilla Readability
function extractWithReadability(html, url) {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent || article.textContent.trim().length < 100) {
    return null;
  }

  return {
    title: article.title || '',
    content: article.textContent.trim(),
    excerpt: article.excerpt || '',
    byline: article.byline || '',
    siteName: article.siteName || '',
    method: 'readability',
    length: article.textContent.trim().length,
  };
}

// Strategy 2: Cheerio segment extraction
function extractWithCheerio(html) {
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $('script, style, nav, footer, header, aside, .sidebar, .ad, .advertisement, .social-share, .comments').remove();

  const title = $('title').text().trim()
    || $('h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content')
    || '';

  // Extract text from content elements
  const segments = [];
  $('article, main, .content, .post, .entry, [role="main"]').find('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre').each((_, el) => {
    const text = $(el).text().trim();
    if (text.length >= 20) segments.push(text);
  });

  // Fallback: just grab all paragraphs
  if (segments.length < 3) {
    $('p').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length >= 30) segments.push(text);
    });
  }

  if (segments.length === 0) return null;

  const content = segments.join('\n\n');
  if (content.length < 100) return null;

  return {
    title,
    content,
    excerpt: content.slice(0, 200),
    byline: $('meta[name="author"]').attr('content') || '',
    siteName: $('meta[property="og:site_name"]').attr('content') || '',
    method: 'cheerio',
    length: content.length,
  };
}

async function main() {
  const { html, statusCode } = await fetchUrl(url);

  if (statusCode >= 400) {
    console.error(`HTTP ${statusCode} for ${url}`);
    process.exit(1);
  }

  // Try Readability first
  let result = extractWithReadability(html, url);
  if (result) {
    console.log(JSON.stringify(result));
    return;
  }

  // Fallback to Cheerio
  result = extractWithCheerio(html);
  if (result) {
    console.log(JSON.stringify(result));
    return;
  }

  // Last resort: basic text
  const $ = cheerio.load(html);
  $('script, style').remove();
  const text = $('body').text().replace(/\s+/g, ' ').trim();
  if (text.length > 100) {
    console.log(JSON.stringify({
      title: $('title').text().trim(),
      content: text.slice(0, 50000),
      excerpt: text.slice(0, 200),
      byline: '',
      siteName: '',
      method: 'plaintext',
      length: text.length,
    }));
    return;
  }

  console.error('Failed to extract meaningful content');
  process.exit(1);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
