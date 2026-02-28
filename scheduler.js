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

const execAsync = promisify(exec);

const DATA_DIR = process.env.DATA_DIR || './data';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

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
  const [uptime, memory, disk, containers, dockerStats, fail2ban] = await Promise.all([
    runCmd('uptime -p'),
    runCmd("free -h | awk '/Mem/{printf \"RAM: %s used / %s total (%s free)\", $3, $2, $4}; /Swap/{printf \"\\nSwap: %s used / %s total\", $3, $2}'"),
    runCmd("df -h / | tail -1 | awk '{print $3\"/\"$2\" (\"$5\" used)\"}'"),
    runCmd('docker ps --format "{{.Names}}: {{.Status}}" 2>/dev/null'),
    runCmd('docker stats --no-stream --format "{{.Name}}: CPU {{.CPUPerc}} / MEM {{.MemUsage}}" 2>/dev/null'),
    runCmd('fail2ban-client status 2>/dev/null || echo "(not running)"'),
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
  } catch { /* ignore */ }

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
  } catch { /* ignore */ }

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

// Coolify internals + infrastructure that produce noisy but harmless errors
const DEFAULT_EXCLUDE_CONTAINERS = [
  'coolify-sentinel', 'coolify-db', 'coolify-redis', 'coolify-realtime',
];

async function loadLogConfig() {
  return await readJSON(LOG_MONITOR_FILE, {
    enabled: true,
    containers: [],
    excludeContainers: DEFAULT_EXCLUDE_CONTAINERS,
    patterns: ['ERROR', 'FATAL', 'SIGKILL', 'OOMKilled', 'panic'],
    ignorePatterns: ['sentinel/push', 'context deadline exceeded'],
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

  // If no specific containers, check all running ones (minus excluded)
  let containers = config.containers;
  const exclude = config.excludeContainers || DEFAULT_EXCLUDE_CONTAINERS;
  if (containers.length === 0) {
    try {
      const { stdout } = await execAsync('docker ps --format "{{.Names}}" 2>/dev/null', { timeout: 5000 });
      containers = stdout.trim().split('\n').filter(Boolean);
    } catch {
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
            return true; // non-JSON lines pass through
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

  // 2. Daily briefing at 6am Trinidad (= 10am UTC, Gil wakes ~5:30am AST)
  cron.schedule('0 10 * * *', async () => {
    try {
      const briefing = await generateBriefing();
      await sockRef.sock.sendMessage(ADMIN_JID, { text: briefing });
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

  // 5. Nightly synthesis at 8pm Trinidad (= midnight UTC)
  // Gil turns off Starlink by 9pm AST, so all nightly jobs run before 8:30pm AST
  cron.schedule('0 0 * * *', async () => {
    try {
      const synthesis = await generateDailySynthesis();
      // Only notify if there are meaningful events
      if (synthesis.regressions.count > 0 || synthesis.friction.totalEvents > 5) {
        const msg = formatSynthesisMessage(synthesis);
        await sockRef.sock.sendMessage(ADMIN_JID, { text: msg });
        console.log('🧠 Sent nightly synthesis');
      } else {
        console.log('🧠 Nightly synthesis: clean day, no alert sent');
      }
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
    } catch (err) {
      console.error('Heartbeat error:', err.message);
    }
  });
  console.log('💓 Heartbeat scheduled (every 2 hours)');

  // 8. Session guard — kill zombie Claude processes every minute
  cron.schedule('* * * * *', async () => {
    try {
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

  console.log('⏰ Scheduler ready');
}
