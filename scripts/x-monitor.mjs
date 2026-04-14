#!/usr/bin/env node
/**
 * x-monitor.mjs - Watch X/Twitter accounts and alert via WhatsApp.
 *
 * Runs on the host so it can use a logged-in browser over CDP.
 * Success digests go to WhatsApp only when there are new posts.
 * Failures are tracked through the shared job runtime and page immediately.
 *
 * Commands:
 *   (none) | check          Check all watched accounts (cron mode)
 *   check <handle>          Check a single account
 *   add <handle> [name]     Add an account to watch
 *   remove <handle>         Remove an account
 *   list                    List watched accounts + last check times
 *   status                  Show detailed state for all accounts
 *   peek <handle>           Fetch latest posts and display (no alert, no state change)
 */

import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createJobRuntime, JobDelivery, JobExecutor } from '../lib/job-runtime.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const REPORTS_DIR = resolve(DATA_DIR, 'reports');
const CONFIG_FILE = resolve(DATA_DIR, 'x-watch-config.json');
const STATE_FILE = resolve(DATA_DIR, 'x-watch-state.json');
const LOCK_FILE = resolve(DATA_DIR, 'x-monitor.lock');
const ENV_FILE = resolve(ROOT, '.env');

const CDP_URL = process.env.X_MONITOR_CDP_URL || 'http://127.0.0.1:9223';
const API_URL = process.env.OVERLORD_SEND_API_URL || 'http://127.0.0.1:3001/api/send';
const FAILURE_ALERT_COOLDOWN_MS = Number(process.env.X_MONITOR_FAILURE_ALERT_COOLDOWN_MS || 6 * 60 * 60 * 1000);
const TIMELINE_SELECTORS = [
  '[data-testid="tweet"]',
  '[data-testid="cellInnerDiv"] article',
  'article a[href*="/status/"]',
  '[aria-label*="Timeline"] article',
];
const LOGIN_SELECTORS = [
  'input[name="text"]',
  'input[autocomplete="username"]',
  '[data-testid="loginButton"]',
];

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function truncate(text, max = 240) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeHandle(handle) {
  return handle.replace(/^@/, '').toLowerCase();
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(data, null, 2));
}

function writeReport(type, content) {
  ensureDir(REPORTS_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const file = resolve(REPORTS_DIR, `${type}_${ts}.txt`);
  writeFileSync(file, content);

  const history = readdirSync(REPORTS_DIR)
    .filter((name) => name.startsWith(`${type}_`))
    .sort()
    .reverse();
  for (const oldFile of history.slice(20)) {
    try {
      unlinkSync(resolve(REPORTS_DIR, oldFile));
    } catch {
      // Best effort report pruning.
    }
  }
}

function loadEnvToken() {
  if (process.env.WEBHOOK_TOKEN) return process.env.WEBHOOK_TOKEN;
  const env = readFileSync(ENV_FILE, 'utf-8');
  const match = env.match(/^WEBHOOK_TOKEN=(.+)$/m);
  if (!match) throw new Error('WEBHOOK_TOKEN not in .env');
  return match[1].trim().replace(/^["']|["']$/g, '');
}

function loadConfig() {
  return readJSON(CONFIG_FILE, { accounts: [] });
}

function saveConfig(config) {
  writeJSON(CONFIG_FILE, config);
}

function loadState() {
  return readJSON(STATE_FILE, {});
}

function saveState(state) {
  writeJSON(STATE_FILE, state);
}

function createRuntime(token) {
  return createJobRuntime({
    dataDir: DATA_DIR,
    sendAdminText: async (text) => sendWhatsApp(token, text),
    writeReport,
  });
}

function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const pid = readFileSync(LOCK_FILE, 'utf-8').trim();
    if (pid && Number(pid) > 0) {
      try {
        process.kill(Number(pid), 0);
        log(`Another instance running (PID ${pid}), exiting`);
        process.exit(0);
      } catch {
        log(`Stale lock from PID ${pid}, taking over`);
      }
    }
  }
  writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock() {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // Ignore.
  }
}

async function connectChrome() {
  const resp = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(5000) });
  const { webSocketDebuggerUrl } = await resp.json();
  return puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl, defaultViewport: null });
}

async function sendWhatsApp(token, message) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ to: 'admin', text: message }),
  });

  if (!resp.ok) {
    throw new Error(`API ${resp.status}: ${await resp.text()}`);
  }
}

async function capturePageSnapshot(page) {
  const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 1200) || '');
  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    bodyText,
  };
}

function classifyPageState(snapshot) {
  const text = snapshot.bodyText.toLowerCase();
  if (text.includes('sign in to x') || text.includes('log in to x') || text.includes('enter your phone')) {
    return 'X session is logged out';
  }
  if (text.includes('something went wrong') || text.includes('posts are not loading right now')) {
    return 'X timeline returned an error state';
  }
  if (text.includes('this account does not exist')) {
    return 'X account does not exist';
  }
  return null;
}

async function waitForTimeline(page, handle) {
  const deadline = Date.now() + 25000;

  while (Date.now() < deadline) {
    for (const selector of LOGIN_SELECTORS) {
      if (await page.$(selector)) {
        throw new Error(`X session check failed for @${handle}: login prompt detected`);
      }
    }

    for (const selector of TIMELINE_SELECTORS) {
      if (await page.$(selector)) {
        return selector;
      }
    }

    const snapshot = await capturePageSnapshot(page);
    const classified = classifyPageState(snapshot);
    if (classified) {
      throw new Error(`${classified} (@${handle}, ${snapshot.title || snapshot.url})`);
    }

    await sleep(1000);
  }

  const snapshot = await capturePageSnapshot(page);
  throw new Error(`Timeline content not found for @${handle} (${snapshot.title || snapshot.url})`);
}

async function extractTweets(page) {
  const tweets = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('[data-testid="tweet"], article'));
    const items = [];

    for (const node of nodes) {
      const textNode = node.querySelector('[data-testid="tweetText"], div[lang]');
      const timeNode = node.querySelector('time');
      const socialNode = node.querySelector('[data-testid="socialContext"]');
      let tweetUrl = '';
      let tweetId = '';

      for (const anchor of node.querySelectorAll('a[href*="/status/"]')) {
        const href = anchor.getAttribute('href') || '';
        const match = href.match(/\/status\/(\d+)/);
        if (match) {
          tweetId = match[1];
          tweetUrl = href.startsWith('http') ? href : `https://x.com${href}`;
          break;
        }
      }

      items.push({
        id: tweetId,
        url: tweetUrl,
        text: textNode?.textContent?.trim() || node.innerText?.trim() || '[media]',
        time: timeNode?.getAttribute('datetime') || '',
        displayTime: timeNode?.textContent?.trim() || '',
        isRetweet: /repost/i.test(socialNode?.textContent || ''),
      });
    }

    return items;
  });

  const unique = [];
  const seen = new Set();
  for (const tweet of tweets) {
    if (!tweet.id || seen.has(tweet.id)) continue;
    seen.add(tweet.id);
    unique.push(tweet);
  }
  return unique.slice(0, 20);
}

async function fetchTweets(browser, handle) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForTimeline(page, handle);
    await sleep(1500);

    const tweets = await extractTweets(page);
    if (!tweets.length) {
      const snapshot = await capturePageSnapshot(page);
      throw new Error(`No posts extracted for @${handle} (${snapshot.title || snapshot.url})`);
    }

    return tweets;
  } finally {
    await page.close().catch(() => {});
  }
}

function formatDigest(account, newTweets) {
  const lines = [
    `X Update: @${account.handle}`,
    `${newTweets.length} new post(s)`,
    '',
  ];

  for (const tweet of newTweets.slice(0, 8)) {
    const prefix = tweet.isRetweet ? 'RT: ' : '';
    const text = tweet.text.length > 280 ? `${tweet.text.slice(0, 280)}...` : tweet.text;
    lines.push(`${prefix}${text}`);
    if (tweet.url) lines.push(tweet.url);
    if (tweet.displayTime) lines.push(`  ${tweet.displayTime}`);
    lines.push('');
  }

  if (newTweets.length > 8) {
    lines.push(`... and ${newTweets.length - 8} more`);
  }

  return lines.join('\n').trim();
}

async function cmdAdd(handle, name) {
  const normalized = normalizeHandle(handle);
  const config = loadConfig();
  if (config.accounts.some((account) => account.handle === normalized)) {
    console.log(`Already watching @${normalized}`);
    return;
  }

  config.accounts.push({
    handle: normalized,
    name: name || normalized,
    addedAt: new Date().toISOString().slice(0, 10),
  });
  saveConfig(config);
  console.log(`Added @${normalized} to watch list`);
}

async function cmdRemove(handle) {
  const normalized = normalizeHandle(handle);
  const config = loadConfig();
  const before = config.accounts.length;
  config.accounts = config.accounts.filter((account) => account.handle !== normalized);

  if (config.accounts.length === before) {
    console.log(`@${normalized} not in watch list`);
    return;
  }

  saveConfig(config);
  const state = loadState();
  delete state[normalized];
  saveState(state);
  console.log(`Removed @${normalized} from watch list`);
}

function cmdList() {
  const config = loadConfig();
  const state = loadState();
  if (config.accounts.length === 0) {
    console.log('No accounts watched');
    return;
  }

  console.log(`Watching ${config.accounts.length} account(s):\n`);
  for (const account of config.accounts) {
    const snapshot = state[account.handle];
    const lastCheck = snapshot?.lastCheck ? new Date(snapshot.lastCheck).toLocaleString() : 'never';
    const tweetCount = snapshot?.lastTweetIds?.length || 0;
    console.log(`  @${account.handle} (${account.name})`);
    console.log(`    Added: ${account.addedAt} | Last check: ${lastCheck} | Tracked posts: ${tweetCount}`);
  }
}

async function cmdStatus() {
  const config = loadConfig();
  const state = loadState();
  if (config.accounts.length === 0) {
    console.log('No accounts watched');
    return;
  }

  console.log('=== X Monitor Status ===\n');
  for (const account of config.accounts) {
    const snapshot = state[account.handle];
    console.log(`@${account.handle} (${account.name})`);
    if (!snapshot) {
      console.log('  No data yet (never checked)\n');
      continue;
    }
    console.log(`  Last check: ${snapshot.lastCheck ? new Date(snapshot.lastCheck).toLocaleString() : 'never'}`);
    console.log(`  Tracked post IDs: ${snapshot.lastTweetIds?.length || 0}`);
    if (snapshot.lastTweetIds?.[0]) console.log(`  Latest post ID: ${snapshot.lastTweetIds[0]}`);
    if (snapshot.lastErrorAt) console.log(`  Last error: ${snapshot.lastErrorAt} | ${snapshot.lastError}`);
    console.log();
  }

  try {
    await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(3000) });
    console.log('Chrome CDP: reachable');
  } catch {
    console.log('Chrome CDP: NOT reachable');
  }
}

async function cmdPeek(handle) {
  const normalized = normalizeHandle(handle);
  let browser;
  try {
    browser = await connectChrome();
    const tweets = await fetchTweets(browser, normalized);
    console.log(`Latest ${tweets.length} posts from @${normalized}:\n`);
    for (const tweet of tweets) {
      const prefix = tweet.isRetweet ? '[RT] ' : '';
      console.log(`${prefix}${tweet.text}`);
      console.log(`  ${tweet.url} ${tweet.displayTime}`);
      console.log();
    }
  } finally {
    if (browser) await browser.disconnect().catch(() => {});
  }
}

async function runCheck(accounts, token) {
  const state = loadState();
  const runtime = createRuntime(token);
  const now = new Date().toISOString();

  return runtime.runJob({
    id: 'x-monitor',
    label: 'X monitor',
    trigger: 'host-browser cron',
    executor: JobExecutor.HOST_BROWSER,
    delivery: JobDelivery.HYBRID,
    reportType: 'x-monitor',
    freshnessSlaMinutes: 12 * 60,
    escalation: 'whatsapp_first',
    failureAlertCooldownMs: FAILURE_ALERT_COOLDOWN_MS,
  }, async () => {
    const summaryLines = [];
    const failures = [];
    let deliveredPosts = 0;
    let browser;

    try {
      browser = await connectChrome();
      log('Connected to Chrome CDP');

      for (const account of accounts) {
        const prev = state[account.handle] || { lastTweetIds: [], lastCheck: null };

        try {
          log(`Checking @${account.handle}...`);
          const tweets = await fetchTweets(browser, account.handle);
          log(`Fetched ${tweets.length} post(s) for @${account.handle}`);

          const prevIds = new Set(prev.lastTweetIds || []);
          const newTweets = tweets.filter((tweet) => !prevIds.has(tweet.id) && !tweet.isRetweet);

          state[account.handle] = {
            ...prev,
            lastCheck: now,
            lastTweetIds: tweets.map((tweet) => tweet.id).slice(0, 50),
            lastError: null,
            lastErrorAt: null,
          };

          if (newTweets.length > 0 && prev.lastCheck) {
            const digest = formatDigest(account, newTweets);
            await sendWhatsApp(token, digest);
            deliveredPosts += newTweets.length;
            summaryLines.push(`@${account.handle}: delivered ${newTweets.length} new post(s)`);
          } else if (!prev.lastCheck) {
            summaryLines.push(`@${account.handle}: baseline refreshed`);
          } else {
            summaryLines.push(`@${account.handle}: no new posts`);
          }
        } catch (err) {
          const message = truncate(err.message || err, 280);
          log(`ERROR @${account.handle}: ${message}`);
          failures.push(`@${account.handle}: ${message}`);
          state[account.handle] = {
            ...prev,
            lastError: message,
            lastErrorAt: now,
          };
          summaryLines.push(`@${account.handle}: failed - ${message}`);
        }
      }
    } finally {
      saveState(state);
      if (browser) await browser.disconnect().catch(() => {});
    }

    const report = [
      `X MONITOR REPORT - ${new Date(now).toISOString()}`,
      ...summaryLines,
    ].join('\n');

    if (failures.length > 0) {
      throw new Error(failures.join('\n'));
    }

    return {
      summary: `X monitor checked ${accounts.length} account(s); delivered ${deliveredPosts} new post(s)`,
      report,
      suppressSuccessAlert: true,
    };
  });
}

async function cmdCheck(singleHandle) {
  acquireLock();

  try {
    const config = loadConfig();
    let accounts = config.accounts;

    if (singleHandle) {
      const normalized = normalizeHandle(singleHandle);
      accounts = accounts.filter((account) => account.handle === normalized);
      if (accounts.length === 0) {
        console.log(`@${normalized} is not in the watch list. Use 'add' first.`);
        return;
      }
    }

    if (accounts.length === 0) {
      console.log('No accounts to check. Use "add <handle>" first.');
      return;
    }

    const token = loadEnvToken();
    const result = await runCheck(accounts, token);
    if (!result.ok) process.exit(1);
    log('Done');
  } catch (err) {
    log(`FATAL: ${truncate(err.message || err, 300)}`);
    process.exit(1);
  } finally {
    releaseLock();
  }
}

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case 'add':
    if (!args[0]) {
      console.error('Usage: x-monitor.mjs add <handle> [display name]');
      process.exit(1);
    }
    await cmdAdd(args[0], args.slice(1).join(' ') || undefined);
    break;
  case 'remove':
    if (!args[0]) {
      console.error('Usage: x-monitor.mjs remove <handle>');
      process.exit(1);
    }
    await cmdRemove(args[0]);
    break;
  case 'list':
    cmdList();
    break;
  case 'status':
    await cmdStatus();
    break;
  case 'peek':
    if (!args[0]) {
      console.error('Usage: x-monitor.mjs peek <handle>');
      process.exit(1);
    }
    await cmdPeek(args[0]);
    break;
  case 'check':
    await cmdCheck(args[0]);
    break;
  default:
    await cmdCheck();
    break;
}
