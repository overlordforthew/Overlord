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
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import crypto from 'crypto';
import path from 'path';
import {
  generateDailySynthesis, formatSynthesisMessage,
  recordDailyMetrics, logFriction, getFrictionReport,
} from './meta-learning.js';
import { createJobRuntime, JobDelivery, JobExecutor, loadJobState, loadRecentJobRuns } from './lib/job-runtime.js';
import { createObserverGuard } from './lib/observer-guard.js';
import { normalizeAlertHashText, shouldIgnoreContainerLogLine } from './lib/log-alert-utils.js';
import { runHeartbeat } from './heartbeat.js';
import { sweepZombies } from './session-guard.js';
import { createTask, getActiveTasks, getRecentDoneTasks, formatTaskList, TaskStatus, closeTask, getDueGoalFollowUps, updateTask, addTaskEvent } from './task-store.js';
import { executeTaskAutonomously, createAndExecuteTask, handleBackgroundTaskError, recoverCheckpoints } from './executor.js';
import { initErrorWatcher, watchDockerEvents, checkTraefik5xx } from './error-watcher.js';
import { runStrategicPatrol } from './strategic-patrol.js';
import { generateScorecard } from './portfolio-scorecard.js';
import { runKpiCheck } from './kpi-tracker.js';
import { runStudySession } from './idle-study.js';
import { checkExperiments } from './experiment-engine.js';
import { evolve } from './evolution-engine.js';
import { getSynthesisPrompt, regenerateIndex, lintWiki, appendLog } from './knowledge-engine.js';
import { splitMessage } from './lib/split-message.js';
import { analyzeError, formatAnalyzedAlert, buildEnrichedNextAction } from './error-analyzer.js';

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
const REPORTS_DIR = path.join(DATA_DIR, 'reports');
const ALERT_AUDIT_RETENTION_DAYS = Number(process.env.ALERT_AUDIT_RETENTION_DAYS || 14);
const ALERT_AUDIT_FILE_PATTERN = /^alert-audit-\d{4}-\d{2}-\d{2}\.jsonl$/;
if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
const observerGuard = createObserverGuard({ dataDir: DATA_DIR });

/**
 * Write a report to disk instead of sending to WhatsApp.
 * Reports are pulled on demand via /reports command.
 */
function writeReport(type, content) {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(REPORTS_DIR, `${type}_${ts}.txt`);
    writeFileSync(file, content);
    console.log(`📄 Report saved: ${type} (${content.length} chars)`);
    // Prune old reports: keep last 20 per type
    const all = readdirSync(REPORTS_DIR)
      .filter(f => f.startsWith(type + '_'))
      .sort()
      .reverse();
    for (const old of all.slice(20)) {
      unlinkSync(path.join(REPORTS_DIR, old));
    }
  } catch (err) {
    console.error(`[Report] Failed to write ${type}:`, err.message);
  }
}

/** Send a long message as multiple WhatsApp chunks instead of truncating */
async function safeSendChunked(sockRef, jid, text) {
  const chunks = splitMessage(text);
  for (let i = 0; i < chunks.length; i++) {
    const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length}) ` : '';
    await sockRef.sock.sendMessage(jid, { text: prefix + chunks[i] });
    if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
  }
}

function createSchedulerJobRuntime(sockRef) {
  return createJobRuntime({
    dataDir: DATA_DIR,
    adminJid: ADMIN_JID,
    sendAdminText: async (text) => safeSendChunked(sockRef, ADMIN_JID, text),
    writeReport,
  });
}

function truncateText(text, max = 120) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function formatJobAge(timestamp) {
  if (!timestamp) return 'never';
  const ageMs = Date.now() - Date.parse(timestamp);
  if (!Number.isFinite(ageMs) || ageMs < 0) return timestamp;
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatGoalTime(timestamp) {
  if (!timestamp) return 'not set';
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

async function processGoalFollowUps(sockRef) {
  const goals = await getDueGoalFollowUps(10);
  if (goals.length === 0) {
    return { sent: 0, summary: 'No goal follow-ups due.' };
  }

  const nowIso = new Date().toISOString();
  let sent = 0;
  const failures = [];

  for (const goal of goals) {
    try {
      const jid = goal.chatJid || ADMIN_JID;
      const overdue = goal.dueAt && Date.parse(goal.dueAt) < Date.now();
      const dueText = goal.dueAt ? formatGoalTime(goal.dueAt) : 'open-ended';
      const cadenceMs = goal.followUpCadenceMs || (overdue ? 24 * 60 * 60 * 1000 : null);

      const lines = [
        `🎯 Goal follow-up: ${goal.title}`,
        `Goal ID: ${goal.id}`,
        `Status: ${goal.status}`,
        `Due: ${dueText}`,
      ];
      if (goal.nextAction) lines.push(`Next action: ${goal.nextAction}`);
      if (goal.lastResult) lines.push(`Last update: ${goal.lastResult.substring(0, 180)}`);
      if (overdue) lines.push('This goal is overdue and will keep resurfacing until you close it.');

      await safeSendChunked(sockRef, jid, lines.join('\n'));
      sent += 1;

      await updateTask(goal.id, {
        status: goal.status === TaskStatus.NEW ? TaskStatus.SCHEDULED : goal.status,
        lastFollowUpSentAt: nowIso,
        followUpCount: (goal.followUpCount || 0) + 1,
        followUpAt: cadenceMs ? new Date(Date.now() + cadenceMs).toISOString() : null,
      });
      await addTaskEvent(goal.id, {
        type: 'follow_up_sent',
        description: overdue
          ? 'Overdue goal follow-up sent and rescheduled'
          : 'Goal follow-up sent',
      });
    } catch (err) {
      failures.push(`${goal.id}: ${err.message}`);
      await addTaskEvent(goal.id, {
        type: 'follow_up_failed',
        description: 'Goal follow-up send failed',
        error: err.message,
      });
    }
  }

  if (failures.length > 0) {
    throw new Error(`Goal follow-up failures: ${failures.join('; ')}`);
  }

  return {
    sent,
    summary: `Sent ${sent} goal follow-up reminder(s).`,
  };
}

function isJobStale(job) {
  if (!job?.freshnessSlaMinutes) return false;
  const lastHealthyAt = Date.parse(job.lastSuccessAt || job.lastRunAt || 0);
  if (!lastHealthyAt) return true;
  return (Date.now() - lastHealthyAt) > (job.freshnessSlaMinutes * 60000);
}

export async function getJobStatusReport(limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 20);
  const state = await loadJobState(DATA_DIR);
  const recentRuns = await loadRecentJobRuns(DATA_DIR, 50);
  const jobs = Object.values(state.jobs || {});

  if (jobs.length === 0) {
    return '🤖 No scheduled jobs have recorded state yet.';
  }

  const failing = jobs.filter((job) => job.lastRunStatus === 'failed');
  const stale = jobs.filter((job) => isJobStale(job));
  const attention = jobs
    .filter((job) => job.lastRunStatus === 'failed' || isJobStale(job))
    .sort((a, b) => {
      const aFailed = a.lastRunStatus === 'failed' ? 1 : 0;
      const bFailed = b.lastRunStatus === 'failed' ? 1 : 0;
      if (aFailed !== bFailed) return bFailed - aFailed;
      return Date.parse(b.lastRunAt || 0) - Date.parse(a.lastRunAt || 0);
    })
    .slice(0, safeLimit);

  const lines = [
    '🤖 *Job Registry*',
    '',
    `Tracked: ${jobs.length} | Failing: ${failing.length} | Stale: ${stale.length}`,
  ];

  if (attention.length > 0) {
    lines.push('', '*Needs Attention:*');
    for (const job of attention) {
      const status = job.lastRunStatus === 'failed' ? 'FAILED' : 'STALE';
      const detail = job.lastRunStatus === 'failed'
        ? (job.lastFailure || 'last run failed')
        : `last success ${formatJobAge(job.lastSuccessAt || job.lastRunAt)}`;
      lines.push(`- ${job.label || job.id} [${status}] — ${detail}`);
    }
  }

  const recentInterestingRuns = recentRuns
    .filter((run) => run.status !== 'ok')
    .slice(0, safeLimit);

  if (recentInterestingRuns.length > 0) {
    lines.push('', '*Recent Non-OK Runs:*');
    for (const run of recentInterestingRuns) {
      const why = run.reason || run.error || 'non-ok run';
      lines.push(`- ${run.label}: ${run.status} (${truncateText(run.startedAt || run.finishedAt || '', 32)}) — ${truncateText(why, 90)}`);
    }
  }

  if (attention.length === 0 && recentInterestingRuns.length === 0) {
    const healthiest = jobs
      .sort((a, b) => Date.parse(b.lastSuccessAt || b.lastRunAt || 0) - Date.parse(a.lastSuccessAt || a.lastRunAt || 0))
      .slice(0, Math.min(5, safeLimit));
    lines.push('', '*Recent Healthy Jobs:*');
    for (const job of healthiest) {
      lines.push(`- ${job.label || job.id} — last success ${formatJobAge(job.lastSuccessAt || job.lastRunAt)}`);
    }
  }

  return lines.join('\n');
}

const SCHEDULES_FILE = path.join(DATA_DIR, 'schedules.json');
const URL_WATCHES_FILE = path.join(DATA_DIR, 'url-watches.json');
const LOG_MONITOR_FILE = path.join(DATA_DIR, 'log-monitor.json');

/** Build the per-day alert audit log path used for later review. */
function getAlertAuditFile(ts = new Date()) {
  return path.join(DATA_DIR, `alert-audit-${ts.toISOString().slice(0, 10)}.jsonl`);
}

/** Build a compact audit row for each analyzed log alert decision. */
function buildLogAlertAuditEntry(alert, batchId, deliveryStatus) {
  return {
    ts: new Date().toISOString(),
    batchId,
    source: 'log-monitor',
    container: alert.container,
    friendlyContainer: alert.friendly,
    errorHash: alert.errorHash || null,
    deliveryStatus,
    noise: Boolean(alert.analysis?.noise),
    severity: alert.analysis?.severity || null,
    rootCause: alert.analysis?.rootCause || null,
    action: alert.analysis?.action || null,
    errorText: alert.errorText,
  };
}

/** Persist structured alert audit rows so future reviews do not depend on raw logs alone. */
async function appendAlertAuditEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  try {
    const lines = entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
    await fs.appendFile(getAlertAuditFile(), lines, 'utf8');
    pruneAlertAuditFiles();
  } catch (err) {
    console.error('[AlertAudit] Failed to append audit rows:', err.message);
  }
}

/** Delete old daily audit files so review history stays useful without growing forever. */
function pruneAlertAuditFiles(now = new Date()) {
  if (!existsSync(DATA_DIR)) return;
  const cutoffMs = now.getTime() - (ALERT_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const files = readdirSync(DATA_DIR).filter((file) => ALERT_AUDIT_FILE_PATTERN.test(file));
    for (const file of files) {
      const day = file.slice('alert-audit-'.length, 'alert-audit-'.length + 10);
      const fileTs = Date.parse(`${day}T00:00:00.000Z`);
      if (Number.isNaN(fileTs) || fileTs >= cutoffMs) continue;
      unlinkSync(path.join(DATA_DIR, file));
    }
  } catch (err) {
    console.error('[AlertAudit] Failed to prune audit files:', err.message);
  }
}

/** Convert the latest audit rows into a concise admin-facing summary. */
function formatAlertAuditSummary(entries, scannedFiles, limit) {
  if (entries.length === 0) return '📋 Alert audit\nNo alert audit entries yet.';

  const deliveryCounts = entries.reduce((acc, entry) => {
    const key = entry.deliveryStatus || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const containerCounts = entries.reduce((acc, entry) => {
    const key = entry.friendlyContainer || entry.container || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const deliverySummary = Object.entries(deliveryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => `${status}: ${count}`)
    .join(', ');
  const containerSummary = Object.entries(containerCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name} (${count})`)
    .join(', ');

  const recentLines = entries.slice(0, limit).map((entry) => {
    const ts = entry.ts ? entry.ts.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z') : 'unknown time';
    const target = entry.friendlyContainer || entry.container || 'unknown container';
    const outcome = entry.deliveryStatus || 'unknown';
    const reason = (entry.rootCause || entry.action || entry.errorText || 'No details')
      .replace(/\s+/g, ' ')
      .slice(0, 120);
    return `• ${ts} — ${target} — ${outcome}${entry.noise ? ' (noise)' : ''}\n  ${reason}`;
  });

  return [
    '📋 Alert audit',
    `Showing ${Math.min(entries.length, limit)} recent row(s) from ${scannedFiles} file(s)`,
    `Delivery states: ${deliverySummary || 'none'}`,
    `Containers: ${containerSummary || 'none'}`,
    '',
    ...recentLines,
  ].join('\n');
}

/** Read recent audit rows for fast “was this real?” checks from WhatsApp. */
export async function getRecentAlertAuditSummary(limit = 10) {
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 25);
  if (!existsSync(DATA_DIR)) return '📋 Alert audit\nNo alert audit entries yet.';

  try {
    const files = readdirSync(DATA_DIR)
      .filter((file) => ALERT_AUDIT_FILE_PATTERN.test(file))
      .sort()
      .reverse();

    if (files.length === 0) return '📋 Alert audit\nNo alert audit entries yet.';

    const entries = [];
    let scannedFiles = 0;

    for (const file of files.slice(0, 7)) {
      const raw = await fs.readFile(path.join(DATA_DIR, file), 'utf8');
      scannedFiles += 1;
      const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean).reverse();
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // Ignore partial/corrupt rows so one bad line does not break review.
        }
        if (entries.length >= safeLimit * 3) break;
      }
      if (entries.length >= safeLimit * 3) break;
    }

    entries.sort((a, b) => Date.parse(b.ts || 0) - Date.parse(a.ts || 0));
    return formatAlertAuditSummary(entries, scannedFiles, safeLimit);
  } catch (err) {
    return `❌ Alert audit unavailable: ${err.message}`;
  }
}

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
const DEFAULT_LOG_PATTERNS = ['ERROR', 'FATAL', 'SIGKILL', 'OOMKilled', 'panic'];
const DEFAULT_IGNORE_PATTERNS = [
  'sentinel/push',
  'context deadline exceeded',
  '"error":0',
  '"error": 0',
  'request error: aborted',
  'stream errored out',
  '[ErrorAnalyzer]',
  '[AI Triage]',
  '[LogMonitor] AI analysis failed',
  '[mc-auth] Unexpected error on idle client: terminating connection due to administrator command',
];
async function loadLogConfig() {
  const config = await readJSON(LOG_MONITOR_FILE, {
    enabled: true,
    containers: [],
    excludeContainers: DEFAULT_EXCLUDE_CONTAINERS,
    patterns: DEFAULT_LOG_PATTERNS,
    ignorePatterns: DEFAULT_IGNORE_PATTERNS,
    lastCheck: null,
    alertedHashes: [],
  });
  if (!Array.isArray(config.excludeContainers)) config.excludeContainers = [...DEFAULT_EXCLUDE_CONTAINERS];
  if (!Array.isArray(config.patterns) || config.patterns.length === 0) config.patterns = [...DEFAULT_LOG_PATTERNS];
  if (!Array.isArray(config.ignorePatterns)) config.ignorePatterns = [...DEFAULT_IGNORE_PATTERNS];
  if (!Array.isArray(config.alertedHashes)) config.alertedHashes = [];
  // Merge any new default exclusions into persisted config
  for (const name of DEFAULT_EXCLUDE_CONTAINERS) {
    if (!config.excludeContainers.includes(name)) {
      config.excludeContainers.push(name);
    }
  }
  for (const pattern of DEFAULT_IGNORE_PATTERNS) {
    if (!config.ignorePatterns.includes(pattern)) {
      config.ignorePatterns.push(pattern);
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
  const alerts = [];       // structured: { container, friendly, errorText, analysis }

  for (const container of containers) {
    try {
      const { stdout } = await execAsync(
        `docker logs --since "${since}" "${container}" 2>&1 | grep -i "${pattern}" | tail -5`,
        { timeout: 10000 }
      );

      if (stdout.trim()) {
        // Filter out suppressed patterns + low-severity Pino JSON logs
        const filtered = stdout.trim().split('\n')
          .filter(line => !shouldIgnoreContainerLogLine(container, line, ignorePatterns))
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

        const errorHash = crypto.createHash('md5').update(normalizeAlertHashText(filtered)).digest('hex');

        // Deduplicate — don't alert same errors repeatedly
        if (!config.alertedHashes.includes(errorHash)) {
          const friendly = await resolveContainerName(container);
          alerts.push({ container, friendly, errorText: filtered.substring(0, 300), errorHash });
          config.alertedHashes.push(errorHash);
          // Keep only last 100 hashes
          if (config.alertedHashes.length > 100) config.alertedHashes = config.alertedHashes.slice(-100);
        }
      }
    } catch { /* no matches or container doesn't exist */ }
  }

  await saveLogConfig(config);

  if (alerts.length > 0) {
    const batchId = crypto.randomUUID();
    // AI-powered error analysis before alerting
    let analyzedAlerts = alerts;
    try {
      analyzedAlerts = await Promise.all(
        alerts.map(async (a) => {
          const analysis = await analyzeError(a.friendly, a.errorText);
          return { ...a, analysis };
        })
      );
    } catch (err) {
      console.warn('[LogMonitor] AI analysis failed, sending raw alerts:', err.message);
      analyzedAlerts = alerts.map(a => ({ ...a, analysis: null }));
    }

    // Filter out noise (AI-identified harmless errors)
    const actionable = analyzedAlerts.filter(a => !a.analysis?.noise);
    const noiseCount = analyzedAlerts.length - actionable.length;
    if (noiseCount > 0) console.log(`[LogMonitor] AI filtered ${noiseCount} noise alert(s)`);

    let actionableDeliveryStatus = actionable.length > 0 ? 'delivery_failed' : 'suppressed_noise';
    if (actionable.length > 0) {
      // Format WhatsApp message with AI analysis
      const formattedAlerts = actionable.map(a => {
        if (a.analysis && a.analysis.rootCause !== 'Analysis unavailable') {
          return formatAnalyzedAlert(a.friendly, a.errorText, a.analysis);
        }
        return `\u{1F433} ${a.friendly}:\n${a.errorText}`;
      });

      const msg = `\u{26A0}\u{FE0F} Log alerts detected:\n\n${formattedAlerts.join('\n\n')}`;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (!sockRef.sock?.ws?.isOpen) {
            if (attempt < 2) { await new Promise(r => setTimeout(r, 5000)); continue; }
            console.error('Failed to send log alert: socket not open after 3 attempts');
            actionableDeliveryStatus = 'socket_unavailable';
            break;
          }
          await safeSendChunked(sockRef, ADMIN_JID, msg);
          writeReport('log-alert', msg);
          console.log(`\u{26A0}\u{FE0F} Sent ${actionable.length} analyzed alert(s)`);
          actionableDeliveryStatus = 'sent';
          break;
        } catch (err) {
          if (attempt === 2) {
            console.error('Failed to send log alert:', err.message);
            actionableDeliveryStatus = 'delivery_failed';
          }
          else await new Promise(r => setTimeout(r, 5000));
        }
      }
    }

    await appendAlertAuditEntries(
      analyzedAlerts.map((alert) =>
        buildLogAlertAuditEntry(
          alert,
          batchId,
          alert.analysis?.noise ? 'suppressed_noise' : actionableDeliveryStatus
        )
      )
    );

    // Auto-create repair tasks for actionable alerts with enriched context
    for (const alert of actionable) {
      try {
        const containerName = alert.friendly;

        // Check if there's already an active repair task for this specific container
        // Stale tasks (>15 min in_progress) are auto-closed so they don't block new repairs
        const existing = await getActiveTasks(ADMIN_JID);
        const STALE_MS = 15 * 60 * 1000;
        for (const t of existing) {
          if (t.kind === 'repair' && t.project === containerName && t.status === 'in_progress') {
            const age = Date.now() - new Date(t.startedAt || t.createdAt).getTime();
            if (age > STALE_MS) {
              await closeTask(t.id, TaskStatus.DONE, 'Auto-closed: stale repair task (>15min)');
              console.log(`\u{1F9F9} Closed stale repair task ${t.id} for ${containerName}`);
            }
          }
        }
        const freshExisting = await getActiveTasks(ADMIN_JID);
        const alreadyTracked = freshExisting.some(t =>
          t.kind === 'repair' &&
          t.project === containerName
        );

        if (!alreadyTracked) {
          const signal = await observerGuard.trackSignal({
            key: `log:${alert.container}:${alert.errorHash}`,
            minHits: alert.analysis?.severity === 'critical' ? 1 : 2,
            cooldownMs: 30 * 60 * 1000,
            meta: {
              container: alert.container,
              friendly: alert.friendly,
              errorHash: alert.errorHash,
            },
          });
          if (!signal.shouldEscalate) {
            continue;
          }

          const baseAction = `Check logs for ${containerName}, identify root cause, fix it, verify recovery`;
          const nextAction = alert.analysis
            ? buildEnrichedNextAction(containerName, alert.errorText, alert.analysis, baseAction)
            : baseAction;
          const priority = alert.analysis?.severity === 'critical' ? 'urgent' : 'high';

          const task = await createTask({
            title: `Auto-repair: ${containerName} error detected`,
            kind: 'repair',
            chatJid: ADMIN_JID,
            owner: 'Gil',
            project: containerName,
            priority,
            riskLevel: 'low',
            executor: 'container',
            dedupeKey: `log:${alert.container}`,
            escalation: 'whatsapp_first',
            successCriteria: `${containerName} container healthy, no new errors`,
            nextAction,
            verifier: {
              type: 'command',
              command: `docker inspect --format='{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "${alert.container}" 2>/dev/null`,
              expectRegex: 'true',
              failureMessage: `${containerName} is not reporting as running`,
            },
            source: 'observer',
          });
          console.log(`\u{1F527} Created repair task ${task.id} for ${containerName}`);

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
  const jobRuntime = createSchedulerJobRuntime(sockRef);
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

  // 1b. Goal follow-through sweep every 15 minutes
  cron.schedule('*/15 * * * *', async () => {
    const run = await jobRuntime.runJob({
      id: 'goal-follow-up',
      label: 'Goal follow-through sweep',
      trigger: '*/15 * * * *',
      executor: JobExecutor.CONTAINER,
      delivery: JobDelivery.HYBRID,
      reportType: 'goal-follow-up',
      freshnessSlaMinutes: 30,
      escalation: 'whatsapp_first',
    }, async () => {
      const result = await processGoalFollowUps(sockRef);
      return {
        summary: result.summary,
        suppressSuccessAlert: true,
        writeReport: false,
      };
    });
    if (run.ok) writeHeartbeat('goal-follow-up');
  });
  console.log('🎯 Goal follow-through scheduled (every 15 min)');

  // 2. Daily briefing at 6am Trinidad (= 10am UTC, Gil wakes ~5:30am AST)
  // WhatsApp-first delivery with report artifact on disk
  cron.schedule('0 10 * * *', async () => {
    const run = await jobRuntime.runJob({
      id: 'daily-briefing',
      label: 'Daily briefing',
      trigger: '0 10 * * *',
      executor: JobExecutor.CONTAINER,
      delivery: JobDelivery.WHATSAPP_FIRST,
      reportType: 'daily-briefing',
      freshnessSlaMinutes: 24 * 60,
      escalation: 'whatsapp_first',
    }, async () => {
      const briefing = await generateBriefing();
      return {
        message: briefing,
        report: briefing,
      };
    });
    if (run.ok) writeHeartbeat('daily-briefing');
  });
  console.log('☀️ Daily briefing scheduled (6:00 AM AST / 10:00 AM UTC) [whatsapp-first]');

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
  // ALERT only on regressions. Full report saved to disk.
  cron.schedule('0 0 * * *', async () => {
    try {
      const synthesis = await generateDailySynthesis();
      const msg = formatSynthesisMessage(synthesis);
      writeReport('nightly-synthesis', msg);
      // Only alert Gil on actual regressions (broken things)
      if (synthesis.regressions.count > 0) {
        await sockRef.sock.sendMessage(ADMIN_JID, { text: `⚠️ ${synthesis.regressions.count} regression(s) detected — check /reports for details` });
      }
      writeHeartbeat('nightly-synthesis');
    } catch (err) {
      console.error('Nightly synthesis error:', err.message);
    }
  });
  console.log('🧠 Nightly synthesis scheduled (8:00 PM AST / 00:00 UTC) [alert-only]');

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
  // Only forces reconnect when WebSocket is actually dead, not just quiet
  // After 6 reconnects with no messages, back off to every 60 min
  cron.schedule('*/5 * * * *', async () => {
    const silentMs = Date.now() - connectionHealth.lastMessageAt;
    const silentMin = Math.floor(silentMs / 60000);

    // Only trigger during waking hours (5:30am-9pm AST = 9:30-01:00 UTC)
    const hour = new Date().getUTCHours();
    const isWaking = (hour >= 9 && hour <= 23) || hour === 0;
    if (!isWaking) return;

    // Check actual WebSocket state before assuming connection is dead
    const ws = sockRef.sock?.ws;
    const wsOpen = ws && ws.readyState === ws.OPEN;

    // If WebSocket is open and healthy, silence just means nobody is texting — skip
    if (wsOpen && silentMs <= 90 * 60 * 1000) return;

    if (silentMs > 60 * 60 * 1000 || (!wsOpen && silentMs > 10 * 60 * 1000)) {
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

      const wsState = wsOpen ? 'open' : 'closed/missing';
      console.warn(`📡 Silence watchdog: no messages for ${silentMin}min (ws: ${wsState}) — forcing reconnect (attempt ${recentReconnects + 1})`);
      // Don't increment reconnectCount here — the close handler in index.js already does it
      connectionHealth.lastReconnectAt = Date.now();
      try { sockRef.sock?.end(); } catch {}
    }
  });
  console.log('📡 Inbound silence watchdog scheduled (every 5 min)');

  // 8b. Cron health monitor — every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    const run = await jobRuntime.runJob({
      id: 'cron-health-monitor',
      label: 'Cron health monitor',
      trigger: '*/30 * * * *',
      executor: JobExecutor.CONTAINER,
      delivery: JobDelivery.HYBRID,
      reportType: 'cron-health',
      freshnessSlaMinutes: 60,
      escalation: 'whatsapp_first',
    }, async () => {
      const { stdout } = await execAsync('bash /app/scripts/cron-monitor.sh --alert', { timeout: 10000 });
      return {
        summary: stdout.trim(),
        suppressSuccessAlert: true,
        writeReport: false,
      };
    });
    if (run.ok) writeHeartbeat('cron-health-monitor');
  });
  console.log('🔍 Cron health monitor scheduled (every 30 min)');

  // 9. Weekly AI repo intelligence — Friday 10am AST (= 2pm UTC)
  // REPORT — saved to disk, pull via /reports
  cron.schedule('0 14 * * 5', async () => {
    try {
      const { generateReport } = await import('./scripts/github-trending.js');
      const report = await generateReport();
      writeReport('weekly-ai-intel', report);
    } catch (err) {
      console.error('Weekly AI report error:', err.message);
    }
  });
  console.log('📊 Weekly AI repo intelligence scheduled (Friday 10:00 AM AST / 14:00 UTC) [report-only]');

  // 10. Nightly Self-Improvement Protocol — 8:30pm AST
  cron.schedule('30 20 * * *', async () => {
    const run = await jobRuntime.runJob({
      id: 'self-improvement',
      label: 'Self-improvement protocol',
      trigger: '30 20 * * *',
      executor: JobExecutor.CONTAINER,
      delivery: JobDelivery.WHATSAPP_FIRST,
      reportType: 'self-improvement',
      freshnessSlaMinutes: 24 * 60,
      escalation: 'whatsapp_first',
    }, async () => {
      const { execSync } = await import('child_process');
      const report = execSync('node /app/scripts/self-improve.mjs', {
        timeout: 180000,
        encoding: 'utf-8',
        env: { ...process.env },
      }).trim();
      if (!report || report.length <= 50) {
        return {
          skip: true,
          reason: 'Self-improvement report was empty',
        };
      }
      return {
        message: report,
        report,
      };
    });
    if (run.ok) writeHeartbeat('self-improvement');
  }, { timezone: 'America/Puerto_Rico' });
  console.log('🔬 Self-improvement protocol scheduled (8:30 PM AST / 00:30 UTC) [whatsapp-first]');

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
    const run = await jobRuntime.runJob({
      id: 'git-review',
      label: 'Git auto-review',
      trigger: '*/30 * * * *',
      executor: JobExecutor.REPO_WORKER,
      delivery: JobDelivery.WHATSAPP_FIRST,
      reportType: 'git-review',
      freshnessSlaMinutes: 60,
      escalation: 'whatsapp_first',
    }, async () => {
      const findings = [];
      const { autoReviewNewCommits } = await import('./git-reviewer.js');
      await autoReviewNewCommits(async (msg) => {
        findings.push(msg);
      });
      if (findings.length === 0) {
        return {
          skip: true,
          reason: 'No new git review findings',
        };
      }
      const combined = findings.join('\n\n---\n\n');
      return {
        message: combined,
        report: combined,
      };
    });
    if (run.ok) writeHeartbeat('git-review');
  });
  console.log('🔍 Git auto-review scheduled (every 30 min) [whatsapp-first]');

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
  // REPORT — saved to disk, pull via /reports
  cron.schedule('0 22 * * 5', async () => {
    try {
      const { execSync } = await import('child_process');
      const report = execSync('node /app/scripts/weekly-skill-review.mjs', {
        timeout: 120000,
        encoding: 'utf-8',
        env: { ...process.env },
      }).trim();
      if (report && report.length > 50) {
        writeReport('weekly-skill-review', report);
      }
      writeHeartbeat('weekly-skill-review');
    } catch (err) {
      console.error('Weekly skill review error:', err.message);
    }
  });
  console.log('📊 Weekly skill review scheduled (Friday 6:00 PM AST / 22:00 UTC) [report-only]');

  // 19. Strategic Patrol — 11 AM and 5 PM AST (= 15:00 and 21:00 UTC)
  // REPORT — captures output to disk instead of WhatsApp
  const silentSockRef = { sock: { sendMessage: async (jid, msg) => {
    if (msg.text) writeReport('strategic-patrol', msg.text);
  }, sendPresenceUpdate: async () => {} } };
  cron.schedule('0 15,21 * * *', async () => {
    try {
      await runStrategicPatrol(silentSockRef);
      writeHeartbeat('strategic-patrol');
    } catch (err) {
      console.error('Strategic patrol error:', err.message);
    }
  });
  console.log('🔭 Strategic patrol scheduled (11 AM & 5 PM AST / 15:00 & 21:00 UTC) [report-only]');

  // 20. Portfolio Scorecard — Monday 9 AM AST (= 13:00 UTC)
  // REPORT — saved to disk
  const scorecardSilent = { sock: { sendMessage: async (jid, msg) => {
    if (msg.text) writeReport('portfolio-scorecard', msg.text);
  }, sendPresenceUpdate: async () => {} } };
  cron.schedule('0 13 * * 1', async () => {
    try {
      await generateScorecard(scorecardSilent);
      writeHeartbeat('portfolio-scorecard');
    } catch (err) {
      console.error('Portfolio scorecard error:', err.message);
    }
  });
  console.log('📊 Portfolio scorecard scheduled (Monday 9 AM AST / 13:00 UTC) [report-only]');

  // 21. KPI Tracker — Daily 8 AM AST (= 12:00 UTC)
  // REPORT — saved to disk
  const kpiSilent = { sock: { sendMessage: async (jid, msg) => {
    if (msg.text) writeReport('kpi-tracker', msg.text);
  }, sendPresenceUpdate: async () => {} } };
  cron.schedule('0 12 * * *', async () => {
    try {
      await runKpiCheck(kpiSilent);
      writeHeartbeat('kpi-tracker');
    } catch (err) {
      console.error('KPI tracker error:', err.message);
    }
  });
  console.log('📈 KPI tracker scheduled (Daily 8 AM AST / 12:00 UTC) [report-only]');

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
  // REPORT — saved to disk
  const experimentSilent = { sock: { sendMessage: async (jid, msg) => {
    if (msg.text) writeReport('experiment-monitor', msg.text);
  }, sendPresenceUpdate: async () => {} } };
  cron.schedule('30 13 * * *', async () => {
    try {
      await checkExperiments(experimentSilent);
      writeHeartbeat('experiment-monitor');
    } catch (err) {
      console.error('Experiment monitor error:', err.message);
    }
  });
  console.log('🧪 Experiment monitor scheduled (Daily 9:30 AM AST / 13:30 UTC) [report-only]');

  // 24. Free Model Benchmark — Weekly Sunday 6 AM AST (= 10:00 UTC)
  cron.schedule('0 10 * * 0', async () => {
    try {
      console.log('[Benchmark] Starting weekly free model benchmark...');
      const { execFile } = await import('child_process');
      const output = await new Promise((resolve, reject) => {
        let stdout = '';
        let stderr = '';
        const child = execFile('node', ['/app/scripts/benchmark-free-models.mjs'], {
          timeout: 1200000, // 20 min — benchmark tests dozens of models sequentially
          env: { ...process.env, RANKINGS_PATH: '/app/data/free-model-rankings.json' },
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer for verbose output
        }, (err, out, errOut) => {
          if (err) {
            // Still capture partial output on timeout
            console.error('[Benchmark] Process error:', err.message);
            if (stdout) console.log('[Benchmark] Partial output:', stdout.slice(-2000));
            return reject(err);
          }
          resolve(out);
        });
        child.stdout?.on('data', d => { stdout += d; });
        child.stderr?.on('data', d => { stderr += d; });
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

  // 25b. Wiki Lint — Weekly Wednesday 30 min after synthesis (23:30 UTC)
  cron.schedule('30 23 * * 3', () => {
    try {
      console.log('[Knowledge] Running weekly wiki lint...');
      const report = lintWiki();
      const summary = [
        `Pages: ${report.total_pages}, Sources: ${report.total_sources}`,
        `Orphans: ${report.orphans.length}, Stale: ${report.stale.length}`,
        `Stubs: ${report.stubs.length}, Dead links: ${report.deadLinks.length}`,
        `Uningested: ${report.uningested.length}`,
        report.healthy ? 'Status: healthy' : 'Status: issues found',
      ].join('. ');
      appendLog('lint', 'Weekly health check', summary);
      console.log(`[Knowledge] Wiki lint: ${summary}`);
      writeHeartbeat('knowledge-lint');
    } catch (err) {
      console.error('Knowledge lint error:', err.message);
    }
  });

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
