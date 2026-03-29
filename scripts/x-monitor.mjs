#!/usr/bin/env node
/**
 * x-monitor.mjs — Watch X/Twitter accounts and alert via WhatsApp
 *
 * Runs on the HOST to access Chrome CDP at localhost:9223 (logged into X).
 * Sends digests via Overlord's /api/send endpoint.
 *
 * Commands:
 *   (none) | check          Check all watched accounts (cron mode)
 *   check <handle>          Check a single account
 *   add <handle> [name]     Add an account to watch
 *   remove <handle>         Remove an account
 *   list                    List watched accounts + last check times
 *   status                  Show detailed state for all accounts
 *   peek <handle>           Fetch latest tweets and display (no alert, no state change)
 *
 * Cron: 0 13,21 * * *  cd /root/overlord && node scripts/x-monitor.mjs >> logs/x-monitor.log 2>&1
 */

import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_DIR = resolve(ROOT, 'data');
const CONFIG_FILE = resolve(DATA_DIR, 'x-watch-config.json');
const STATE_FILE = resolve(DATA_DIR, 'x-watch-state.json');
const LOCK_FILE = resolve(DATA_DIR, 'x-monitor.lock');
const ENV_FILE = resolve(ROOT, '.env');
const LOG_DIR = resolve(ROOT, 'logs');

const CDP_URL = 'http://127.0.0.1:9223';
const API_URL = 'http://127.0.0.1:3001/api/send';

// ── Helpers ──

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function normalizeHandle(h) {
  return h.replace(/^@/, '').toLowerCase();
}

function loadEnvToken() {
  const env = readFileSync(ENV_FILE, 'utf-8');
  const m = env.match(/^WEBHOOK_TOKEN=(.+)$/m);
  if (!m) throw new Error('WEBHOOK_TOKEN not in .env');
  return m[1].trim().replace(/^["']|["']$/g, '');
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
}

function loadConfig() { return readJSON(CONFIG_FILE, { accounts: [] }); }
function saveConfig(config) { writeJSON(CONFIG_FILE, config); }
function loadState() { return readJSON(STATE_FILE, {}); }
function saveState(state) { writeJSON(STATE_FILE, state); }

// ── Lock ──

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
  try { unlinkSync(LOCK_FILE); } catch {}
}

// ── Chrome CDP ──

async function connectChrome() {
  const resp = await fetch(`${CDP_URL}/json/version`, { signal: AbortSignal.timeout(5000) });
  const { webSocketDebuggerUrl } = await resp.json();
  return puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl, defaultViewport: null });
}

// ── Tweet extraction ──

async function fetchTweets(browser, handle) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`https://x.com/${handle}`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('[data-testid="tweet"]', { timeout: 20000 });
    await new Promise(r => setTimeout(r, 2000));

    return await page.evaluate(() => {
      const els = document.querySelectorAll('[data-testid="tweet"]');
      return Array.from(els).slice(0, 20).map(el => {
        const textEl = el.querySelector('[data-testid="tweetText"]');
        const timeEl = el.querySelector('time');
        let tweetUrl = '', tweetId = '';
        for (const a of el.querySelectorAll('a[href*="/status/"]')) {
          const href = a.getAttribute('href');
          if (href?.includes('/status/')) {
            tweetId = href.split('/status/')[1]?.split(/[?/]/)[0] || '';
            tweetUrl = `https://x.com${href}`;
            break;
          }
        }
        const social = el.querySelector('[data-testid="socialContext"]');
        const isRetweet = !!social?.textContent?.match(/repost/i);
        return {
          text: textEl?.textContent?.trim() || '[media]',
          time: timeEl?.getAttribute('datetime') || '',
          displayTime: timeEl?.textContent?.trim() || '',
          url: tweetUrl,
          id: tweetId,
          isRetweet,
        };
      }).filter(t => t.id);
    });
  } finally {
    await page.close();
  }
}

// ── WhatsApp alert ──

async function sendWhatsApp(token, message) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: 'admin', text: message }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
}

function formatDigest(account, newTweets) {
  const lines = [
    `X Update: @${account.handle}`,
    `${newTweets.length} new post(s)\n`,
  ];
  for (const t of newTweets.slice(0, 8)) {
    const prefix = t.isRetweet ? 'RT: ' : '';
    const text = t.text.length > 280 ? t.text.slice(0, 280) + '...' : t.text;
    lines.push(`${prefix}${text}`);
    if (t.url) lines.push(t.url);
    if (t.displayTime) lines.push(`  ${t.displayTime}`);
    lines.push('');
  }
  if (newTweets.length > 8) lines.push(`... and ${newTweets.length - 8} more`);
  return lines.join('\n').trim();
}

// ── Commands ──

async function cmdAdd(handle, name) {
  handle = normalizeHandle(handle);
  const config = loadConfig();
  if (config.accounts.some(a => a.handle === handle)) {
    console.log(`Already watching @${handle}`);
    return;
  }
  config.accounts.push({ handle, name: name || handle, addedAt: new Date().toISOString().slice(0, 10) });
  saveConfig(config);
  console.log(`Added @${handle} to watch list`);
}

async function cmdRemove(handle) {
  handle = normalizeHandle(handle);
  const config = loadConfig();
  const before = config.accounts.length;
  config.accounts = config.accounts.filter(a => a.handle !== handle);
  if (config.accounts.length === before) {
    console.log(`@${handle} not in watch list`);
    return;
  }
  saveConfig(config);
  // Clean state
  const state = loadState();
  delete state[handle];
  saveState(state);
  console.log(`Removed @${handle} from watch list`);
}

function cmdList() {
  const config = loadConfig();
  const state = loadState();
  if (config.accounts.length === 0) {
    console.log('No accounts watched');
    return;
  }
  console.log(`Watching ${config.accounts.length} account(s):\n`);
  for (const a of config.accounts) {
    const s = state[a.handle];
    const lastCheck = s?.lastCheck ? new Date(s.lastCheck).toLocaleString() : 'never';
    const tweetCount = s?.lastTweetIds?.length || 0;
    console.log(`  @${a.handle} (${a.name})`);
    console.log(`    Added: ${a.addedAt}  |  Last check: ${lastCheck}  |  Tracked tweets: ${tweetCount}`);
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
  for (const a of config.accounts) {
    const s = state[a.handle];
    console.log(`@${a.handle} (${a.name})`);
    if (!s) {
      console.log('  No data yet (never checked)\n');
      continue;
    }
    console.log(`  Last check: ${new Date(s.lastCheck).toLocaleString()}`);
    console.log(`  Tracked tweet IDs: ${s.lastTweetIds?.length || 0}`);
    if (s.lastTweetIds?.[0]) console.log(`  Latest tweet ID: ${s.lastTweetIds[0]}`);
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
  handle = normalizeHandle(handle);
  let browser;
  try {
    browser = await connectChrome();
    const tweets = await fetchTweets(browser, handle);
    console.log(`Latest ${tweets.length} tweets from @${handle}:\n`);
    for (const t of tweets) {
      const prefix = t.isRetweet ? '[RT] ' : '';
      console.log(`${prefix}${t.text}`);
      console.log(`  ${t.url}  ${t.displayTime}`);
      console.log();
    }
  } finally {
    if (browser) await browser.disconnect();
  }
}

async function cmdCheck(singleHandle) {
  mkdirSync(LOG_DIR, { recursive: true });
  acquireLock();

  try {
    const config = loadConfig();
    let accounts = config.accounts;
    if (singleHandle) {
      const h = normalizeHandle(singleHandle);
      accounts = accounts.filter(a => a.handle === h);
      if (accounts.length === 0) {
        console.log(`@${h} is not in the watch list. Use 'add' first.`);
        return;
      }
    }
    if (accounts.length === 0) {
      console.log('No accounts to check. Use "add <handle>" first.');
      return;
    }

    const token = loadEnvToken();
    const state = loadState();
    const browser = await connectChrome();
    log('Connected to Chrome CDP');

    try {
      for (const account of accounts) {
        try {
          log(`Checking @${account.handle}...`);
          const tweets = await fetchTweets(browser, account.handle);
          log(`Got ${tweets.length} tweets`);

          const prev = state[account.handle] || { lastTweetIds: [], lastCheck: null };
          const prevIds = new Set(prev.lastTweetIds || []);
          // Only original posts — skip retweets
          const newTweets = tweets.filter(t => !prevIds.has(t.id) && !t.isRetweet);

          state[account.handle] = {
            lastCheck: new Date().toISOString(),
            lastTweetIds: tweets.map(t => t.id).slice(0, 50),
          };

          if (newTweets.length > 0 && prev.lastCheck) {
            const digest = formatDigest(account, newTweets);
            await sendWhatsApp(token, digest);
            log(`Sent ${newTweets.length} new tweet(s)`);
            console.log(digest);
          } else if (!prev.lastCheck) {
            log('First run — baseline set, no alert');
          } else {
            log('No new tweets');
          }
        } catch (err) {
          log(`ERROR @${account.handle}: ${err.message}`);
        }
      }
      saveState(state);
      log('Done');
    } finally {
      await browser.disconnect();
    }
  } catch (err) {
    log(`FATAL: ${err.message}`);
    process.exit(1);
  } finally {
    releaseLock();
  }
}

// ── CLI router ──

const [cmd, ...args] = process.argv.slice(2);

switch (cmd) {
  case 'add':
    if (!args[0]) { console.error('Usage: x-monitor.mjs add <handle> [display name]'); process.exit(1); }
    await cmdAdd(args[0], args.slice(1).join(' ') || undefined);
    break;
  case 'remove':
    if (!args[0]) { console.error('Usage: x-monitor.mjs remove <handle>'); process.exit(1); }
    await cmdRemove(args[0]);
    break;
  case 'list':
    cmdList();
    break;
  case 'status':
    await cmdStatus();
    break;
  case 'peek':
    if (!args[0]) { console.error('Usage: x-monitor.mjs peek <handle>'); process.exit(1); }
    await cmdPeek(args[0]);
    break;
  case 'check':
    await cmdCheck(args[0]);
    break;
  default:
    // No command or unrecognized = check all (cron compat)
    await cmdCheck();
    break;
}
