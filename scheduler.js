/**
 * scheduler.js — Proactive engine for Overlord
 *
 * Manages:
 * 1. Reminders — one-time or recurring cron-based messages
 * 2. Daily briefing — 6am server health summary
 * 3. URL monitoring — periodic change detection
 * 4. Log monitoring — periodic error scanning
 * 5. Heartbeat — service health monitoring with auto-restart
 * 6. Session guard — zombie Claude process cleanup
 */

import cron from 'node-cron';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import crypto from 'crypto';
import path from 'path';
import {
  generateDailySynthesis, formatSynthesisMessage,
  recordDailyMetrics, logFriction, getFrictionReport,
} from './meta-learning.js';
import { runHeartbeat } from './heartbeat.js';
import { sweepZombies } from './session-guard.js';
import { createTask, getActiveTasks, getRecentDoneTasks, formatTaskList, TaskStatus, closeTask } from './task-store.js';
import { executeTaskAutonomously, createAndExecuteTask, handleBackgroundTaskError, recoverCheckpoints } from './executor.js';
import { initErrorWatcher, watchDockerEvents, checkTraefik5xx } from './error-watcher.js';
import { runStrategicPatrol } from './strategic-patrol.js';
import { generateScorecard } from './portfolio-scorecard.js';
import { runKpiCheck } from './kpi-tracker.js';
import { runStudySession } from './idle-study.js';
import { checkExperiments } from './experiment-engine.js';
import { evolve } from './evolution-engine.js';
import { writeFileSync, readFileSync } from 'fs';
import { getSynthesisPrompt, regenerateIndex } from './knowledge-engine.js';
import { splitMessage } from './lib/split-message.js';

const execAsync = promisify(exec);

function writeHeartbeat(jobName) {
  try {
    const dir = '/app/data/cron-heartbeats';
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, jobName), String(Math.floor(Date.now() / 1000)));
  } catch (err) { console.debug('[Heartbeat] Write failed:', err.message); }
}

const DATA_DIR = process.env.DATA_DIR || './data';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

/** Send a long message as multiple WhatsApp chunks instead of truncating */
async function safeSendChunked(sockRef, jid, text) {
  const chunks = splitMessage(text);
  for (let i = 0; i < chunks.length; i++) {
    const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length}) ` : '';
    await sockRef.sock.sendMessage(jid, { text: prefix + chunks[i] });
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }
}

const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const URL_WATCHES_FILE = path.join(DATA_DIR, 'url-watches.json');
const LOG_MONITOR_FILE = path.join(DATA_DIR, 'log-monitor.json');

// Active cron jobs keyed by reminder ID
const activeJobs = new Map();

// Human-readable names for containers (static + cached dynamic lookups)
const CONTAINER_NAMES = {
  'coolify-proxy': 'Traefik Proxy',
  'coolify': 'Coolify',
  'coolify-realtime': 'Coolify Realtime',
  'coolify-db': 'Coolify DB',
  'coolify-redis': 'Coolify Redis',
  'coolify-sentinel': 'Coolify Sentinel',
  'overlord': 'Overlord (WhatsApp Bot)',
  'surfababe': 'SurfaBabe (WhatsApp Bot)',
  'mastercommander': 'MasterCommander',
};

// Resolve Coolify hash container names to project names via Docker labels
async function resolveContainerName(name) {
  if (CONTAINER_NAMES[name]) return CONTAINER_NAMES[name];
  try {
    // Use serviceName + projectName to build a clean friendly name
    const { stdout } = await execAsync(
      `docker inspect --format '{{index .Config.Labels "coolify.serviceName"}}|||{{index .Config.Labels "coolify.projectName"}}' "${name}" 2>/dev/null`,
      { timeout: 3000 }
    );
    const [svc, proj] = stdout.trim().split('|||');
    let friendly = '';
    if (svc && svc !== '<no value>') {
      // Clean up Coolify's verbose service names (e.g. "bluemele-beast-modemain-xxx" → use project name)
      if (svc.startsWith('bluemele-') && proj && proj !== '<no value>') {
        friendly = proj.charAt(0).toUpperCase() + proj.slice(1);
      } else if (svc === 'api' && proj && proj !== '<no value>') {
        friendly = `${proj.charAt(0).toUpperCase() + proj.slice(1)} API`;
      } else {
        friendly = svc.charAt(0).toUpperCase() + svc.slice(1);
      }
      // Distinguish app vs db containers (Coolify prefixes container names with db-, app-, etc.)
      if (friendly && name.startsWith('db-')) {
        friendly += '-db';
      }
    }
    if (friendly) {
      CONTAINER_NAMES[name] = friendly; // cache it
      return friendly;
    }
  } catch {}
  return name; // fallback to raw name
}

async function friendlyContainerList(rawOutput) {
  const lines = rawOutput.trim().split('\n').filter(Boolean);
  const resolved = await Promise.all(lines.map(async (line) => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return line;
    const rawName = line.substring(0, colonIdx).trim();
    const rest = line.substring(colonIdx);
    const friendly = await resolveContainerName(rawName);
    return `${friendly}${rest}`;
  }));
  return resolved.join('\n');
}

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
  // Beszel monitoring helper
  async function getBeszelHealth() {
    try {
      const resp = await fetch('http://beszel:8090/api/health', { signal: AbortSignal.timeout(3000) });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (err) { console.debug('[Briefing] Beszel health unavailable:', err.message); return null; }
  }

  const [uptime, memory, disk, containers, dockerStats, fail2ban, beszelHealth] = await Promise.all([
    runCmd('uptime -p'),
    runCmd("free -h | awk '/Mem/{printf \"RAM: %s used / %s total (%s free)\", $3, $2, $4}; /Swap/{printf \"\\nSwap: %s used / %s total\", $3, $2}'"),
    runCmd("df -h / | tail -1 | awk '{print $3\"/\"$2\" (\"$5\" used)\"}'"),
    runCmd('docker ps --format "{{.Names}}: {{.Status}}" 2>/dev/null'),
    runCmd('docker stats --no-stream --format "{{.Name}}: CPU {{.CPUPerc}} / MEM {{.MemUsage}}" 2>/dev/null'),
    runCmd('fail2ban-client status 2>/dev/null || echo "(not running)"'),
    getBeszelHealth(),
  ]);

  // Resolve container names to human-readable
  const friendlyContainers = containers ? await friendlyContainerList(containers) : '(none running)';
  const friendlyStats = dockerStats ? await friendlyContainerList(dockerStats) : '(unavailable)';

  // Get fail2ban banned count per jail
  let f2bSummary = '';
  try {
    const { stdout } = await execAsync(
      'for jail in $(fail2ban-client status 2>/dev/null | grep "Jail list" | sed "s/.*://;s/,//g"); do count=$(fail2ban-client status "$jail" 2>/dev/null | grep "Currently banned" | awk "{print \\$NF}"); total=$(fail2ban-client status "$jail" 2>/dev/null | grep "Total banned" | awk "{print \\$NF}"); echo "$jail: $count active / $total total"; done',
      { timeout: 10000 }
    );
    f2bSummary = stdout.trim();
  } catch (err) { console.debug('[Briefing] Fail2ban summary unavailable:', err.message); }

  // Check for recent errors in container logs (last 6 hours)
  let recentErrors = '';
  try {
    const { stdout } = await execAsync(
      'docker ps --format "{{.Names}}" 2>/dev/null | while read name; do errs=$(docker logs --since 6h "$name" 2>&1 | grep -i "error\\|fatal\\|oom\\|killed" | tail -2); if [ -n "$errs" ]; then echo "[$name]"; echo "$errs"; fi; done',
      { timeout: 15000 }
    );
    if (stdout.trim()) {
      // Resolve container names in error output
      recentErrors = stdout.trim();
      for (const [raw, friendly] of Object.entries(CONTAINER_NAMES)) {
        recentErrors = recentErrors.replaceAll(`[${raw}]`, `[${friendly}]`);
      }
    }
  } catch (err) { console.debug('[Briefing] Recent error scan failed:', err.message); }

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  const lines = [
    `☀️ Morning Briefing — ${dateStr}`,
    '',
    `⏱️ Uptime: ${uptime}`,
    `💾 ${memory}`,
    `💿 Disk: ${disk}`,
    '',
    `🐳 Containers:\n${friendlyContainers}`,
    '',
    `📊 Resources:\n${friendlyStats}`,
  ];

  if (f2bSummary) {
    lines.push('', `🛡️ Fail2ban:\n${f2bSummary}`);
  }

  if (beszelHealth) {
    lines.push('', `📈 Beszel: monitoring active (${beszelHealth.message || 'healthy'})`);
  }

  if (recentErrors) {
    lines.push('', `⚠️ Recent errors (6h):\n${recentErrors.substring(0, 500)}`);
  } else {
    lines.push('', '✅ No errors in the last 6 hours');
  }

  // Task status
  try {
    const activeTasks = await getActiveTasks();
    const doneTasks = await getRecentDoneTasks(null, 24);
    if (activeTasks.length > 0) {
      lines.push('', `📋 Active tasks (${activeTasks.length}):\n${formatTaskList(activeTasks).substring(0, 400)}`);
    }
    if (doneTasks.length > 0) {
      lines.push(`✅ Completed (24h): ${doneTasks.length} task(s)`);
    }
  } catch { /* non-fatal */ }

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

// Coolify internals + infrastructure that produce noisy but harmless errors
const DEFAULT_EXCLUDE_CONTAINERS = [
  'coolify-sentinel', 'coolify-db', 'coolify-redis', 'coolify-realtime',
  'shannon-browser-1', 'shannon-worker-1', 'shannon-temporal-1',
  'searxng', 'seneca-site',
];

async function loadLogConfig() {
  const config = await readJSON(LOG_MONITOR_FILE, {
    enabled: true,
    containers: [],
    excludeContainers: DEFAULT_EXCLUDE_CONTAINERS,
    patterns: ['ERROR', 'FATAL', 'SIGKILL', 'OOMKilled', 'panic'],
    ignorePatterns: ['sentinel/push', 'context deadline exceeded', '"error":0', '"error": 0', 'request error: aborted'],
    lastCheck: null,
    alertedHashes: [],
  });
  // Merge any new default exclusions into persisted config
  for (const name of DEFAULT_EXCLUDE_CONTAINERS) {
    if (!config.excludeContainers.includes(name)) {
      config.excludeContainers.push(name);
    }
  }
  return config;
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

  // If no specific containers, check all running ones (minus excluded)
  let containers = config.containers;
  const exclude = config.excludeContainers || DEFAULT_EXCLUDE_CONTAINERS;
  if (containers.length === 0) {
    try {
      const { stdout } = await execAsync('docker ps --format "{{.Names}}" 2>/dev/null', { timeout: 5000 });
      containers = stdout.trim().split('\n').filter(Boolean);
    } catch (err) {
      console.warn('[LogMonitor] Cannot list containers:', err.message);
      return;
    }
  }
  containers = containers.filter(c => !exclude.includes(c));

  const pattern = config.patterns.join('\\|');
  const ignorePatterns = config.ignorePatterns || [];
  const alerts = [];

  for (const container of containers) {
    try {
      const { stdout } = await execAsync(
        `docker logs --since "${since}" "${container}" 2>&1 | grep -i "${pattern}" | tail -5`,
        { timeout: 10000 }
      );

      if (stdout.trim()) {
        // Filter out suppressed patterns + low-severity Pino JSON logs
        const filtered = stdout.trim().split('\n')
          .filter(line => !ignorePatterns.some(ip => line.includes(ip)))
          .filter(line => {
            // If it's a Pino JSON log, only keep errors (level >= 50)
            try {
              const j = JSON.parse(line);
              if (typeof j.level === 'number') return j.level >= 50;
            } catch {}
            // For non-JSON lines, require "error" to appear as a standalone
            // severity indicator, not as part of a compound word or info message
            const lower = line.toLowerCase();
            if (lower.includes('error')) {
              // Skip lines where "error" is part of a label/title, not an actual error
              if (/\berror watcher\b/i.test(line)) return false;
              if (/\b(postmortem|executor|knowledge base)\b/i.test(line)) return false;
              if (/^\s*[🔧⏰☀️🌐📋🧠💓🛡️🔍📊🤖🔮🗜️👁️📨✅👤🤖📡🔗]\s/u.test(line)) return false;
            }
            return true;
          })
          .join('\n');
        if (!filtered.trim()) continue;

        const errorHash = crypto.createHash('md5').update(filtered).digest('hex');

        // Deduplicate — don't alert same errors repeatedly
        if (!config.alertedHashes.includes(errorHash)) {
          const friendly = await resolveContainerName(container);
        alerts.push(`🐳 ${friendly}:\n${filtered.substring(0, 300)}`);
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
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!sockRef.sock?.ws?.isOpen) {
          if (attempt < 2) { await new Promise(r => setTimeout(r, 5000)); continue; }
          console.error('Failed to send log alert: socket not open after 3 attempts');
          break;
        }
        await safeSendChunked(sockRef, ADMIN_JID, msg);
        console.log(`⚠️ Sent ${alerts.length} log alert(s)`);
        break;
      } catch (err) {
        if (attempt === 2) console.error('Failed to send log alert:', err.message);
        else await new Promise(r => setTimeout(r, 5000));
      }
    }

    // Auto-create repair tasks for each alert and attempt autonomous fix
    for (const alert of alerts) {
      try {
        // Extract container name from alert
        const containerMatch = alert.match(/🐳 ([^:]+):/);
        const containerName = containerMatch ? containerMatch[1].trim() : 'unknown';

        // Check if there's already an active repair task for this specific container
        // Stale tasks (>15 min in_progress) are auto-closed so they don't block new repairs
        const existing = await getActiveTasks(ADMIN_JID);
        const STALE_MS = 15 * 60 * 1000;
        for (const t of existing) {
          if (t.kind === 'repair' && t.project === containerName && t.status === 'in_progress') {
            const age = Date.now() - new Date(t.startedAt || t.createdAt).getTime();
            if (age > STALE_MS) {
              await closeTask(t.id, TaskStatus.DONE, 'Auto-closed: stale repair task (>15min)');
              console.log(`🧹 Closed stale repair task ${t.id} for ${containerName}`);
            }
          }
        }
        const freshExisting = await getActiveTasks(ADMIN_JID);
        const alreadyTracked = freshExisting.some(t =>
          t.kind === 'repair' &&
          t.project === containerName
        );

        if (!alreadyTracked) {
          const task = await createTask({
            title: `Auto-repair: ${containerName} error detected`,
            kind: 'repair',
            chatJid: ADMIN_JID,
            owner: 'Gil',
            project: containerName,
            priority: 'high',
            riskLevel: 'low',
            successCriteria: `${containerName} container healthy, no new errors`,
            nextAction: `Check logs for ${containerName}, identify root cause, fix it, verify recovery`,
            source: 'observer',
          });
          console.log(`🔧 Created repair task ${task.id} for ${containerName}`);

          // Execute autonomously in background (non-blocking)
          executeTaskAutonomously(task, sockRef).catch(err => {
            handleBackgroundTaskError(err, task, sockRef);
          });
        }
      } catch (err) {
        console.error('Failed to create auto-repair task:', err.message);
      }
    }
  }
}

// ============================================================
// MAIN SCHEDULER
// ============================================================

export async function startScheduler(sockRef, connectionHealth) {
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

  // 2. Daily briefing at 6am Trinidad (= 10am UTC, Gil wakes ~5:30am AST)
  cron.schedule('0 10 * * *', async () => {
    try {
      const briefing = await generateBriefing();
      await sockRef.sock.sendMessage(ADMIN_JID, { text: briefing });
      writeHeartbeat('daily-briefing');
      console.log('☀️ Sent daily briefing');
    } catch (err) {
      console.error('Failed to send daily briefing:', err.message);
    }
  });
  console.log('☀️ Daily briefing scheduled (6:00 AM AST / 10:00 AM UTC)');

  // 3. URL monitoring every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    try {
      await checkURLChanges(sockRef);
      writeHeartbeat('url-monitor');
    } catch (err) {
      console.error('URL monitor error:', err.message);
    }
  });
  console.log('🔗 URL monitor scheduled (every 15 min)');

  // 4. Log monitoring every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      await checkContainerLogs(sockRef);
      writeHeartbeat('log-monitor');
    } catch (err) {
      console.error('Log monitor error:', err.message);
    }
  });
  console.log('📋 Log monitor scheduled (every 5 min)');

  // 5. Nightly synthesis at 8pm Trinidad (= midnight UTC)
  // Gil turns off Starlink by 9pm AST, so all nightly jobs run before 8:30pm AST
  cron.schedule('0 0 * * *', async () => {
    try {
      const synthesis = await generateDailySynthesis();
      // Notify if there are meaningful events or insights worth surfacing
      if (synthesis.regressions.count > 0 || synthesis.friction.totalEvents > 3 || synthesis.insights?.length > 0) {
        const msg = formatSynthesisMessage(synthesis);
        await sockRef.sock.sendMessage(ADMIN_JID, { text: msg });
        console.log('🧠 Sent nightly synthesis');
      } else {
        console.log('🧠 Nightly synthesis: clean day, no alert sent');
      }
      writeHeartbeat('nightly-synthesis');
    } catch (err) {
      console.error('Nightly synthesis error:', err.message);
    }
  });
  console.log('🧠 Nightly synthesis scheduled (8:00 PM AST / 00:00 UTC)');

  // 6. Daily performance metrics at 8:15pm Trinidad (= 00:15 UTC)
  cron.schedule('15 0 * * *', async () => {
    try {
      const { stdout: diskRaw } = await execAsync("df -h / | tail -1 | awk '{print $5}'", { timeout: 5000 });
      const { stdout: memRaw } = await execAsync("free | awk '/Mem/{printf \"%.1f\", $3/$2*100}'", { timeout: 5000 });
      const { stdout: containers } = await execAsync("docker ps -q | wc -l", { timeout: 5000 });

      // Get friction count for today
      const frictionReport = await getFrictionReport(24);

      await recordDailyMetrics({
        diskUsagePct: parseFloat(diskRaw.replace('%', '').trim()) || 0,
        memoryUsagePct: parseFloat(memRaw.trim()) || 0,
        containersRunning: parseInt(containers.trim()) || 0,
        frictionEvents: frictionReport.total,
      });
      console.log('📊 Recorded daily performance metrics');
    } catch (err) {
      console.error('Performance metrics error:', err.message);
    }
  });
  console.log('📊 Performance trending scheduled (8:15 PM AST / 00:15 UTC)');

  // 7. Heartbeat — service health monitoring every 2 hours
  cron.schedule('0 */2 * * *', async () => {
    try {
      await runHeartbeat(sockRef);
      writeHeartbeat('heartbeat');
    } catch (err) {
      console.error('Heartbeat error:', err.message);
    }
  });
  console.log('💓 Heartbeat scheduled (every 2 hours)');

  // 8. Session guard — kill zombie Claude processes every minute
  cron.schedule('* * * * *', async () => {
    try {
      writeHeartbeat('session-guard');
      const killed = await sweepZombies();
      if (killed.length > 0) {
        const msg = `🔪 Session Guard: killed ${killed.length} hung session(s)\n` +
          killed.map(k => `PID ${k.pid} (${k.ageMin}min old)`).join('\n');
        await sockRef.sock.sendMessage(ADMIN_JID, { text: msg });
      }
    } catch (err) {
      console.error('Session guard error:', err.message);
    }
  });
  console.log('🛡️ Session guard scheduled (every 1 min)');

  // 8a2. Inbound silence watchdog — every 5 minutes
  // Backoff: reconnect at 10min, then wait progressively longer before retrying
  // After 6 reconnects with no messages, back off to every 60 min
  cron.schedule('*/5 * * * *', async () => {
    const silentMs = Date.now() - connectionHealth.lastMessageAt;
    const silentMin = Math.floor(silentMs / 60000);

    // Only trigger during waking hours (5:30am-9pm AST = 9:30-01:00 UTC)
    const hour = new Date().getUTCHours();
    const isWaking = (hour >= 9 && hour <= 23) || hour === 0;
    if (!isWaking) return;

    if (silentMs > 30 * 60 * 1000) {
      const recentReconnects = connectionHealth.reconnectCount;
      const timeSinceReconnect = Date.now() - connectionHealth.lastReconnectAt;

      // Backoff: after 6 reconnects, only retry every 60 min instead of every 5
      const backoffThreshold = 6;
      const backoffIntervalMs = 60 * 60 * 1000; // 60 min
      if (recentReconnects >= backoffThreshold && timeSinceReconnect < backoffIntervalMs) {
        return; // Still in backoff window, skip this cycle
      }

      // Purge stale keys once at 3 reconnects, don't repeat every cycle
      if (recentReconnects === 3) {
        console.warn(`📡 Silence watchdog: ${silentMin}min silent + ${recentReconnects} reconnects — purging stale keys`);
        try {
          const authFiles = await fs.readdir('./auth');
          let purged = 0;
          for (const f of authFiles) {
            if (f.startsWith('pre-key-') || f.startsWith('sender-key-') || f.startsWith('session-')) {
              await fs.unlink(`./auth/${f}`).catch(() => {});
              purged++;
            }
          }
          if (purged) console.warn(`🧹 Purged ${purged} stale Baileys keys`);
        } catch (err) { console.warn('[SilenceWatchdog] Auth key purge failed:', err.message); }
      }

      console.warn(`📡 Silence watchdog: no messages for ${silentMin}min — forcing reconnect (attempt ${recentReconnects + 1})`);
      connectionHealth.reconnectCount++;
      connectionHealth.lastReconnectAt = Date.now();
      try { sockRef.sock?.end(); } catch {}
    }
  });
  console.log('📡 Inbound silence watchdog scheduled (every 5 min)');

  // 8b. Cron health monitor — every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      const { stdout } = await execAsync('bash /app/scripts/cron-monitor.sh', { timeout: 10000 });
      if (stdout.startsWith('STALE:')) {
        const msg = `⚠️ Cron Health Monitor — stale jobs detected:\n${stdout.replace('STALE:', '').trim()}`;
        await sockRef.sock.sendMessage(ADMIN_JID, { text: msg });
        console.log('⚠️ Cron monitor: stale jobs detected');
      }
    } catch (err) {
      // Exit code 1 = stale jobs found (message in stdout)
      if (err.stdout?.startsWith('STALE:')) {
        const msg = `⚠️ Cron Health Monitor — stale jobs detected:\n${err.stdout.replace('STALE:', '').trim()}`;
        await sockRef.sock.sendMessage(ADMIN_JID, { text: msg }).catch(err => { console.error('Failed to send cron health alert:', err.message); });
      }
    }
  });
  console.log('🔍 Cron health monitor scheduled (every 30 min)');

  // 9. Weekly AI repo intelligence — Friday 10am AST (= 2pm UTC)
  cron.schedule('0 14 * * 5', async () => {
    try {
      const { generateReport } = await import('./scripts/github-trending.js');
      const report = await generateReport();
      await sockRef.sock.sendMessage(ADMIN_JID, { text: report });
      console.log('📊 Sent weekly AI repo intelligence report');
    } catch (err) {
      console.error('Weekly AI report error:', err.message);
    }
  });
  console.log('📊 Weekly AI repo intelligence scheduled (Friday 10:00 AM AST / 14:00 UTC)');

  // 10. Nightly Self-Improvement Protocol — 8:30pm AST
  // Runs after daily synthesis (8pm), before Gil's Starlink goes off at 9pm
  cron.schedule('30 20 * * *', async () => {
    try {
      const { execSync } = await import('child_process');
      const report = execSync('node /app/scripts/self-improve.mjs', {
        timeout: 180000,
        encoding: 'utf-8',
        env: { ...process.env },
      }).trim();
      if (report && report.length > 50) {
        if (sockRef.sock?.ws?.isOpen) {
          await sockRef.sock.sendMessage(ADMIN_JID, { text: report });
          console.log('🔬 Sent nightly self-improvement report');
        } else {
          console.warn('🔬 Self-improvement report ready but socket not open, skipping send');
        }
      }
    } catch (err) {
      console.error('Self-improvement report error:', err?.message || err?.signal || String(err));
    }
  }, { timezone: 'America/Puerto_Rico' });
  console.log('🔬 Self-improvement protocol scheduled (8:30 PM AST / 00:30 UTC)');

  // 11. File-based outbox — send messages queued by external scripts
  const outboxPath = '/tmp/wa-outbox.json';
  cron.schedule('*/10 * * * * *', async () => {
    try {
      const { readFileSync, unlinkSync, existsSync } = await import('fs');
      if (!existsSync(outboxPath)) return;
      const raw = readFileSync(outboxPath, 'utf-8');
      unlinkSync(outboxPath);
      const msg = JSON.parse(raw);
      if (msg.jid && msg.text && (Date.now() - msg.ts) < 300000) {
        await safeSendChunked(sockRef, msg.jid, msg.text);
        console.log(`📤 Outbox: sent ${msg.text.length} chars to ${msg.jid}`);
      }
    } catch (err) { if (err.code !== 'ENOENT') console.warn('[Outbox] Send error:', err.message); }
  });

  // 12. Error Watcher — auto-detect container crashes and 5xx spikes
  initErrorWatcher(async (taskParams) => {
    const task = await createTask(taskParams);
    executeTaskAutonomously(task, sockRef).catch(err => {
      handleBackgroundTaskError(err, task, sockRef);
    });
    return task;
  }, sockRef);
  watchDockerEvents();

  // Traefik 5xx check every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      await checkTraefik5xx();
    } catch (err) {
      console.error('Traefik 5xx check error:', err.message);
    }
  });
  console.log('👁️ Error watcher scheduled (docker events + Traefik 5xx every 2 min)');

  // 13. Git auto-review — check for new commits every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      const { autoReviewNewCommits } = await import('./git-reviewer.js');
      await autoReviewNewCommits(async (msg) => {
        await safeSendChunked(sockRef, ADMIN_JID, msg);
      });
      writeHeartbeat('git-review');
    } catch (err) {
      console.error('Git auto-review error:', err.message);
    }
  });
  console.log('🔍 Git auto-review scheduled (every 30 min)');

  // 14. Fleet health check — every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const { checkFleetHealth } = await import('./bot-fleet.js');
      await checkFleetHealth(async (msg) => {
        await safeSendChunked(sockRef, ADMIN_JID, msg);
      });
      writeHeartbeat('fleet-health');
    } catch (err) {
      console.error('Fleet health check error:', err.message);
    }
  });
  console.log('🤖 Fleet health check scheduled (every 5 min)');

  // 15. Predictive infrastructure alerts — daily at 7am AST (= 11am UTC)
  cron.schedule('0 11 * * *', async () => {
    try {
      const { getAlerts } = await import('./predictive-infra.js');
      const alerts = await getAlerts();
      if (alerts.length > 0) {
        const lines = ['🔮 *Predictive Infrastructure Alerts*\n'];
        for (const a of alerts) {
          const emoji = a.severity === 'critical' ? '🔴' : '🟡';
          lines.push(`${emoji} ${a.message}`);
        }
        await sockRef.sock.sendMessage(ADMIN_JID, { text: lines.join('\n') });
      }
      writeHeartbeat('predictive-infra');
    } catch (err) {
      console.error('Predictive infra alert error:', err.message);
    }
  });
  console.log('🔮 Predictive infrastructure alerts scheduled (7:00 AM AST / 11:00 UTC)');

  // 16. Memory v2 health check — every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    try {
      const { initSchema } = await import('./skills/memory-v2/lib/schema.mjs');
      const { getDb } = await import('./skills/memory-v2/lib/db.mjs');
      initSchema();
      const db = getDb();

      const stats = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM observations WHERE status = 'active') as active_obs,
          (SELECT COUNT(*) FROM tool_events WHERE compressed = 0) as uncompressed,
          (SELECT COUNT(*) FROM tool_events) as total_events,
          (SELECT ROUND(AVG(importance), 2) FROM observations WHERE status = 'active') as avg_importance
      `).get();

      const alerts = [];

      // Alert if uncompressed events are piling up (compression may be stuck)
      if (stats.uncompressed > 50) {
        alerts.push(`⚠️ ${stats.uncompressed} uncompressed events — compression may be stuck`);
      }

      // Alert if no active observations exist (possible DB issue)
      if (stats.total_events > 100 && stats.active_obs === 0) {
        alerts.push(`⚠️ 0 active observations despite ${stats.total_events} events — possible issue`);
      }

      // Alert if average importance is dropping too low
      if (stats.avg_importance !== null && stats.avg_importance < 0.2) {
        alerts.push(`⚠️ Average importance ${stats.avg_importance} — consolidation may be too aggressive`);
      }

      if (alerts.length > 0) {
        const msg = `🧠 Memory Health Alert\n\n${alerts.join('\n')}\n\nStats: ${stats.active_obs} obs, ${stats.uncompressed} pending, ${stats.total_events} total events`;
        await sockRef.sock.sendMessage(ADMIN_JID, { text: msg });
        console.log(`🧠 Memory health: ${alerts.length} alert(s) sent`);
      }

      writeHeartbeat('memory-health');
    } catch (err) {
      console.error('Memory health check error:', err.message);
    }
  });
  console.log('🧠 Memory v2 health check scheduled (every 6 hours)');

  // 17. Memory v2 auto-compression — every 6 hours (15 min after health check)
  cron.schedule('15 */6 * * *', async () => {
    try {
      const { execSync } = await import('child_process');
      const output = execSync('node /app/skills/memory-v2/scripts/auto-compress.mjs', {
        timeout: 300000,
        encoding: 'utf-8',
        cwd: '/app',
      });

      // Parse the last JSON line
      const lines = output.trim().split('\n');
      const lastLine = lines[lines.length - 1];
      try {
        const result = JSON.parse(lastLine);
        if (result.observations > 0) {
          console.log(`🗜️ Auto-compressed: ${result.compressed} events → ${result.observations} observations`);
        }
      } catch { /* expected for non-JSON output lines */ }

      writeHeartbeat('auto-compress');
    } catch (err) {
      console.error('Auto-compress error:', err.message);
    }
  });
  console.log('🗜️ Memory v2 auto-compression scheduled (every 6 hours, :15 offset)');

  // 18. Weekly skill review — Friday 6pm AST (= 22:00 UTC)
  // Runs same day as tech intel report but later — review week's performance + queue improvements
  cron.schedule('0 22 * * 5', async () => {
    try {
      const { execSync } = await import('child_process');
      const report = execSync('node /app/scripts/weekly-skill-review.mjs', {
        timeout: 120000,
        encoding: 'utf-8',
        env: { ...process.env },
      }).trim();
      if (report && report.length > 50) {
        await safeSendChunked(sockRef, ADMIN_JID, report);
        console.log('📊 Sent weekly skill review');
      }
      writeHeartbeat('weekly-skill-review');
    } catch (err) {
      console.error('Weekly skill review error:', err.message);
    }
  });
  console.log('📊 Weekly skill review scheduled (Friday 6:00 PM AST / 22:00 UTC)');

  // 19. Strategic Patrol — 11 AM and 5 PM AST (= 15:00 and 21:00 UTC)
  // Reviews projects, deps, errors, infra. Routes findings through autonomy engine.
  cron.schedule('0 15,21 * * *', async () => {
    try {
      await runStrategicPatrol(sockRef);
      writeHeartbeat('strategic-patrol');
    } catch (err) {
      console.error('Strategic patrol error:', err.message);
    }
  });
  console.log('🔭 Strategic patrol scheduled (11 AM & 5 PM AST / 15:00 & 21:00 UTC)');

  // 20. Portfolio Scorecard — Monday 9 AM AST (= 13:00 UTC)
  cron.schedule('0 13 * * 1', async () => {
    try {
      await generateScorecard(sockRef);
      writeHeartbeat('portfolio-scorecard');
    } catch (err) {
      console.error('Portfolio scorecard error:', err.message);
    }
  });
  console.log('📊 Portfolio scorecard scheduled (Monday 9 AM AST / 13:00 UTC)');

  // 21. KPI Tracker — Daily 8 AM AST (= 12:00 UTC)
  cron.schedule('0 12 * * *', async () => {
    try {
      await runKpiCheck(sockRef);
      writeHeartbeat('kpi-tracker');
    } catch (err) {
      console.error('KPI tracker error:', err.message);
    }
  });
  console.log('📈 KPI tracker scheduled (Daily 8 AM AST / 12:00 UTC)');

  // 22. Idle Study — Check every 10 min during waking hours
  let lastMessageAt = Date.now();
  // Update lastMessageAt on any incoming message (set by index.js via export)
  global.__overlordLastMessageAt = lastMessageAt;
  cron.schedule('*/10 * * * *', async () => {
    const idleMs = Date.now() - (global.__overlordLastMessageAt || Date.now());
    const idleMin = idleMs / 60000;
    if (idleMin >= 30) {
      try {
        await runStudySession(sockRef);
        writeHeartbeat('idle-study');
      } catch (err) {
        console.error('Idle study error:', err.message);
      }
    }
  });
  console.log('📚 Idle study scheduled (every 10 min, triggers after 30 min idle)');

  // 23. Experiment Monitor — Daily 9 AM AST (= 13:00 UTC, after scorecard)
  cron.schedule('30 13 * * *', async () => {
    try {
      await checkExperiments(sockRef);
      writeHeartbeat('experiment-monitor');
    } catch (err) {
      console.error('Experiment monitor error:', err.message);
    }
  });
  console.log('🧪 Experiment monitor scheduled (Daily 9:30 AM AST / 13:30 UTC)');

  // 24. Free Model Benchmark — Weekly Sunday 6 AM AST (= 10:00 UTC)
  cron.schedule('0 10 * * 0', async () => {
    try {
      console.log('[Benchmark] Starting weekly free model benchmark...');
      const { execSync } = await import('child_process');
      const output = execSync('node /app/scripts/benchmark-free-models.mjs', {
        encoding: 'utf8',
        timeout: 600000, // 10 min max
        env: { ...process.env, RANKINGS_PATH: '/app/data/free-model-rankings.json' },
      });
      console.log(output);
      writeHeartbeat('free-model-benchmark');
    } catch (err) {
      console.error('Free model benchmark error:', err.message);
    }
  });
  console.log('🏋️ Free model benchmark scheduled (Sunday 6 AM AST / 10:00 UTC)');

  // 25. Knowledge Synthesis — Weekly Wednesday 7 PM AST (= 23:00 UTC)
  // Reviews recent conversations, extracts patterns, updates knowledge files
  cron.schedule('0 23 * * 3', async () => {
    try {
      console.log('[Knowledge] Starting weekly knowledge synthesis...');
      const prompt = getSynthesisPrompt();
      const task = await createTask({
        title: 'Weekly Knowledge Synthesis',
        description: prompt,
        kind: 'complex',
        source: 'scheduler:knowledge-synthesis',
      });
      executeTaskAutonomously(task, sockRef).catch(err => {
        handleBackgroundTaskError(err, task, sockRef);
      });
      writeHeartbeat('knowledge-synthesis');
    } catch (err) {
      console.error('Knowledge synthesis error:', err.message);
    }
  });
  console.log('📚 Knowledge synthesis scheduled (Wednesday 7 PM AST / 23:00 UTC)');

  // 26. Knowledge Index Regeneration — Daily at startup + 6 AM AST (= 10:00 UTC)
  // Quick: just re-scans files and rebuilds INDEX.md
  try {
    const stats = regenerateIndex();
    console.log(`[Knowledge] INDEX.md regenerated: ${stats.files} files, ${stats.categories} categories`);
  } catch (err) {
    console.warn('[Knowledge] Index regeneration failed:', err.message);
  }
  cron.schedule('0 10 * * *', () => {
    try {
      const stats = regenerateIndex();
      console.log(`[Knowledge] Daily index regen: ${stats.files} files, ${stats.categories} categories`);
      writeHeartbeat('knowledge-index');
    } catch (err) {
      console.error('Knowledge index regen error:', err.message);
    }
  });

  // Recover tasks that were in_progress during container restart (delay for WhatsApp socket)
  setTimeout(() => recoverCheckpoints(sockRef), 10000);

  console.log('⏰ Scheduler ready');
}
