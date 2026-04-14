#!/usr/bin/env node
/**
 * screenshot.js — Take a screenshot of a URL using headless Chromium
 * Usage: node /app/scripts/screenshot.js <url> [output.png]
 */

import puppeteer from 'puppeteer-core';

const url = process.argv[2];
const output = process.argv[3] || '/tmp/screenshot.png';

if (!url) {
  console.error('Usage: node screenshot.js <url> [output.png]');
  process.exit(1);
}

const targetUrl = url.startsWith('http') ? url : `https://${url}`;

try {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    headless: 'new',
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.screenshot({ path: output, fullPage: false });
  await browser.close();
  console.log(output);
} catch (err) {
  console.error(`Screenshot failed: ${err.message}`);
  process.exit(1);
}
