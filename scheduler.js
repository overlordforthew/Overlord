/**
 * scheduler.js — Proactive engine for Overlord
 *
 * Manages:
 * 1. Reminders — one-time or recurring cron-based messages
 * 2. Daily briefing — 8am server health summary
 * 3. URL monitoring — periodic change detection
 * 4. Log monitoring — periodic error scanning
 */

import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import crypto from 'crypto';
import path from 'path';

const execAsync = promisify(exec);

const DATA_DIR = process.env.DATA_DIR || './data';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const URL_WATCHES_FILE = path.join(DATA_DIR, 'url-watches.json');
const LOG_MONITOR_FILE = path.join(DATA_DIR, 'log-monitor.json');

// Active cron jobs keyed by reminder ID
const activeJobs = new Map();

// ============================================================
// PERSISTENCE HELPERS
// ============================================================

async function readJSON(file, fallback) {
  try {
    const data = await fs.readFile(file, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function writeJSON(file, data) {
  if (!existsSync(path.dirname(file))) mkdirSync(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ============================================================
// REMINDER SYSTEM
// ============================================================

async function loadReminders() {
  return await readJSON(SCHEDULES_FILE, []);
}

async function saveReminders(reminders) {
  await writeJSON(SCHEDULES_FILE, reminders);
}

function scheduleReminder(reminder, sockRef) {
  if (activeJobs.has(reminder.id)) {
    activeJobs.get(reminder.id).stop();
  }

  if (!cron.validate(reminder.cron)) {
    console.error(`Invalid cron expression for reminder ${reminder.id}: ${reminder.cron}`);
    return false;
  }

  const job = cron.schedule(reminder.cron, async () => {
    try {
      const jid = reminder.chatJid || ADMIN_JID;
      await sockRef.sock.sendMessage(jid, { text: `🔔 Reminder: ${reminder.text}` });
      console.log(`🔔 Fired reminder ${reminder.id}: ${reminder.text}`);

      if (reminder.oneshot) {
        job.stop();
        activeJobs.delete(reminder.id);
        const reminders = await loadReminders();
        await saveReminders(reminders.filter(r => r.id !== reminder.id));
        console.log(`🗑️ Removed oneshot reminder ${reminder.id}`);
      }
    } catch (err) {
      console.error(`Failed to fire reminder ${reminder.id}:`, err.message);
    }
  });

  activeJobs.set(reminder.id, job);
  return true;
}

export async function addReminder(chatJid, cronExpr, text, oneshot, sockRef) {
  // Validate cron expression BEFORE persisting
  if (!cron.validate(cronExpr)) {
    return null;
  }

  const id = crypto.randomBytes(4).toString('hex');
  const reminder = {
    id,
    cron: cronExpr,
    text,
    chatJid: chatJid || ADMIN_JID,
    oneshot: !!oneshot,
    createdAt: new Date().toISOString(),
  };

  const reminders = await loadReminders();
  reminders.push(reminder);
  await saveReminders(reminders);

  scheduleReminder(reminder, sockRef);

  return reminder;
}

export async function removeReminder(id) {
  if (activeJobs.has(id)) {
    activeJobs.get(id).stop();
    activeJobs.delete(id);
  }
  const reminders = await loadReminders();
  const filtered = reminders.filter(r => r.id !== id);
  if (filtered.length === reminders.length) return false;
  await saveReminders(filtered);
  return true;
}

export async function listReminders(chatJid) {
  const reminders = await loadReminders();
  if (chatJid) return reminders.filter(r => r.chatJid === chatJid);
  return reminders;
}

// ============================================================
// DAILY BRIEFING
// ============================================================

async function runCmd(cmd, timeout = 10000) {
  try {
    const { stdout } = await execAsync(cmd, { timeout });
    return stdout.trim();
  } catch {
    return '(unavailable)';
  }
}

export async function generateBriefing() {
  const [uptime, memory, disk, containers, dockerStats] = await Promise.all([
    runCmd('uptime -p'),
    runCmd('free -h | tail -2'),
    runCmd("df -h / | tail -1 | awk '{print $3\"/\"$2\" (\"$5\" used)\"}'"),
    runCmd('docker ps --format "{{.Names}}: {{.Status}}" 2>/dev/null'),
    runCmd('docker stats --no-stream --format "{{.Name}}: CPU {{.CPUPerc}} / MEM {{.MemUsage}}" 2>/dev/null'),
  ]);

  // Check for recent errors in container logs (last 6 hours)
  let recentErrors = '';
  try {
    const { stdout } = await execAsync(
      'docker ps -q | xargs -I{} sh -c \'docker logs --since 6h {} 2>&1 | grep -i "error\\|fatal\\|oom\\|killed" | tail -3\' 2>/dev/null',
      { timeout: 15000 }
    );
    recentErrors = stdout.trim();
  } catch { /* ignore */ }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const lines = [
    `☀️ Morning Briefing — ${dateStr}`,
    '',
    `⏱️ Uptime: ${uptime}`,
    `💾 Memory:\n${memory}`,
    `💿 Disk: ${disk}`,
    '',
    `🐳 Containers:\n${containers || '(none running)'}`,
    '',
    `📊 Resources:\n${dockerStats || '(unavailable)'}`,
  ];

  if (recentErrors) {
    lines.push('', `⚠️ Recent errors (6h):\n${recentErrors.substring(0, 500)}`);
  } else {
    lines.push('', '✅ No errors in the last 6 hours');
  }

  return lines.join('\n');
}

// ============================================================
// URL MONITORING
// ============================================================

async function loadURLWatches() {
  return await readJSON(URL_WATCHES_FILE, []);
}

async function saveURLWatches(watches) {
  await writeJSON(URL_WATCHES_FILE, watches);
}

export async function addURLWatch(url, chatJid) {
  const watches = await loadURLWatches();

  // Don't duplicate
  if (watches.some(w => w.url === url && w.chatJid === chatJid)) {
    return null;
  }

  const watch = {
    id: crypto.randomBytes(4).toString('hex'),
    url,
    chatJid: chatJid || ADMIN_JID,
    interval: 15,
    lastHash: null,
    lastChecked: null,
    createdAt: new Date().toISOString(),
  };

  watches.push(watch);
  await saveURLWatches(watches);
  return watch;
}

export async function removeURLWatch(urlOrId, chatJid) {
  const watches = await loadURLWatches();
  const filtered = watches.filter(w => {
    if (w.id === urlOrId) return false;
    if (w.url === urlOrId && (!chatJid || w.chatJid === chatJid)) return false;
    return true;
  });
  if (filtered.length === watches.length) return false;
  await saveURLWatches(filtered);
  return true;
}

export async function listURLWatches(chatJid) {
  const watches = await loadURLWatches();
  if (chatJid) return watches.filter(w => w.chatJid === chatJid);
  return watches;
}

async function checkURLChanges(sockRef) {
  const watches = await loadURLWatches();
  if (watches.length === 0) return;

  let changed = false;

  for (const watch of watches) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const resp = await fetch(watch.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Overlord-Monitor/1.0' },
      });
      clearTimeout(timeout);

      const body = await resp.text();
      const hash = crypto.createHash('sha256').update(body).digest('hex');

      watch.lastChecked = new Date().toISOString();

      if (watch.lastHash && watch.lastHash !== hash) {
        // Content changed!
        const msg = `🔔 URL changed: ${watch.url}\nDetected at ${watch.lastChecked}\nContent hash: ${hash.substring(0, 12)}...`;
        try {
          await sockRef.sock.sendMessage(watch.chatJid, { text: msg });
        } catch (err) {
          console.error('Failed to send URL change alert:', err.message);
        }
      }

      watch.lastHash = hash;
      changed = true;
    } catch (err) {
      console.error(`URL check failed for ${watch.url}:`, err.message);
    }
  }

  if (changed) await saveURLWatches(watches);
}

// ============================================================
// LOG MONITORING
// ============================================================

async function loadLogConfig() {
  return await readJSON(LOG_MONITOR_FILE, {
    enabled: true,
    containers: [],
    patterns: ['ERROR', 'FATAL', 'SIGKILL', 'OOMKilled', 'panic'],
    lastCheck: null,
    alertedHashes: [],
  });
}

async function saveLogConfig(config) {
  await writeJSON(LOG_MONITOR_FILE, config);
}

export async function getLogMonitorStatus() {
  return await loadLogConfig();
}

export async function addLogMonitorContainer(name) {
  const config = await loadLogConfig();
  if (!config.containers.includes(name)) {
    config.containers.push(name);
    await saveLogConfig(config);
  }
  return config;
}

export async function removeLogMonitorContainer(name) {
  const config = await loadLogConfig();
  config.containers = config.containers.filter(c => c !== name);
  await saveLogConfig(config);
  return config;
}

async function checkContainerLogs(sockRef) {
  const config = await loadLogConfig();
  if (!config.enabled) return;

  const since = config.lastCheck || new Date(Date.now() - 5 * 60000).toISOString();
  config.lastCheck = new Date().toISOString();

  // If no specific containers, check all running ones
  let containers = config.containers;
  if (containers.length === 0) {
    try {
      const { stdout } = await execAsync('docker ps --format "{{.Names}}" 2>/dev/null', { timeout: 5000 });
      containers = stdout.trim().split('\n').filter(Boolean);
    } catch {
      return;
    }
  }

  const pattern = config.patterns.join('\\|');
  const alerts = [];

  for (const container of containers) {
    try {
      const { stdout } = await execAsync(
        `docker logs --since "${since}" "${container}" 2>&1 | grep -i "${pattern}" | tail -5`,
        { timeout: 10000 }
      );

      if (stdout.trim()) {
        const errorHash = crypto.createHash('md5').update(stdout.trim()).digest('hex');

        // Deduplicate — don't alert same errors repeatedly
        if (!config.alertedHashes.includes(errorHash)) {
          alerts.push(`🐳 ${container}:\n${stdout.trim().substring(0, 300)}`);
          config.alertedHashes.push(errorHash);
          // Keep only last 100 hashes
          if (config.alertedHashes.length > 100) config.alertedHashes = config.alertedHashes.slice(-100);
        }
      }
    } catch { /* no matches or container doesn't exist */ }
  }

  await saveLogConfig(config);

  if (alerts.length > 0) {
    const msg = `⚠️ Log alerts detected:\n\n${alerts.join('\n\n')}`;
    try {
      await sockRef.sock.sendMessage(ADMIN_JID, { text: msg.substring(0, 3900) });
      console.log(`⚠️ Sent ${alerts.length} log alert(s)`);
    } catch (err) {
      console.error('Failed to send log alert:', err.message);
    }
  }
}

// ============================================================
// MAIN SCHEDULER
// ============================================================

export async function startScheduler(sockRef) {
  console.log('⏰ Starting scheduler...');

  // 1. Reload persisted reminders
  try {
    const reminders = await loadReminders();
    let loaded = 0;
    for (const r of reminders) {
      if (scheduleReminder(r, sockRef)) loaded++;
    }
    if (loaded > 0) console.log(`⏰ Restored ${loaded} reminder(s)`);
  } catch (err) {
    console.error('Failed to load reminders:', err.message);
  }

  // 2. Daily briefing at 8am
  cron.schedule('0 8 * * *', async () => {
    try {
      const briefing = await generateBriefing();
      await sockRef.sock.sendMessage(ADMIN_JID, { text: briefing });
      console.log('☀️ Sent daily briefing');
    } catch (err) {
      console.error('Failed to send daily briefing:', err.message);
    }
  });
  console.log('☀️ Daily briefing scheduled (8:00 AM)');

  // 3. URL monitoring every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await checkURLChanges(sockRef);
    } catch (err) {
      console.error('URL monitor error:', err.message);
    }
  });
  console.log('🔗 URL monitor scheduled (every 15 min)');

  // 4. Log monitoring every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      await checkContainerLogs(sockRef);
    } catch (err) {
      console.error('Log monitor error:', err.message);
    }
  });
  console.log('📋 Log monitor scheduled (every 5 min)');

  console.log('⏰ Scheduler ready');
}
