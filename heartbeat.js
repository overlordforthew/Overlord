/**
 * heartbeat.js — Self-Healing Service Monitor for Overlord
 *
 * Monitors services via HTTP health checks and Docker container status.
 * Auto-restarts failed containers. Alerts Gil only when self-healing fails.
 *
 * Design principles:
 * - No false positives: requires consecutive failures before acting
 * - Self-healing first: auto-restart before alerting
 * - Quiet when healthy: Gil only hears about real problems
 * - Persistent state: survives bot restarts
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const execAsync = promisify(exec);

const DATA_DIR = process.env.DATA_DIR || './data';
const HEARTBEAT_FILE = path.join(DATA_DIR, 'heartbeat.json');
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

// How many consecutive failures before we attempt auto-restart
const RESTART_THRESHOLD = 3;
// How many consecutive failures (after restart attempt) before alerting Gil
const ALERT_THRESHOLD = 5;
// Cooldown after a restart attempt (ms) — don't restart again too quickly
const RESTART_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Default services to monitor
const DEFAULT_SERVICES = [
  {
    name: 'Overlord',
    type: 'docker',
    container: 'overlord',
    autoRestart: false, // Don't restart ourselves — just alert
  },
  {
    name: 'NamiBarden',
    type: 'http',
    url: 'https://namibarden.com',
    container: null, // Coolify-managed (ock0wowgsgwwww8w00400k00-*)
    autoRestart: false,
    expectedStatus: 200,
  },
  {
    name: 'MasterCommander',
    type: 'http',
    url: 'https://mastercommander.namibarden.com',
    container: 'mastercommander',
    autoRestart: true,
    expectedStatus: 200,
  },
  {
    name: 'Lumina',
    type: 'http',
    url: 'https://lumina.namibarden.com',
    container: null, // Coolify-managed
    autoRestart: false,
    expectedStatus: [200, 302],
  },
  {
    name: 'SurfaBabe',
    type: 'docker',
    container: 'surfababe',
    autoRestart: false, // Ailie controls this
  },
  {
    name: 'Traefik',
    type: 'docker',
    container: 'coolify-proxy',
    autoRestart: false, // Never touch Traefik automatically
  },
];

// ============================================================
// PERSISTENCE
// ============================================================

async function loadState() {
  try {
    const data = await fs.readFile(HEARTBEAT_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return { services: {}, lastRun: null };
  }
}

async function saveState(state) {
  if (!existsSync(path.dirname(HEARTBEAT_FILE))) {
    mkdirSync(path.dirname(HEARTBEAT_FILE), { recursive: true });
  }
  await fs.writeFile(HEARTBEAT_FILE, JSON.stringify(state, null, 2));
}

// ============================================================
// HEALTH CHECKS
// ============================================================

async function checkHTTP(service) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch(service.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Overlord-Heartbeat/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timeout);

    const expected = Array.isArray(service.expectedStatus)
      ? service.expectedStatus
      : [service.expectedStatus || 200];

    if (expected.includes(resp.status)) {
      return { healthy: true, detail: `HTTP ${resp.status}` };
    }
    return { healthy: false, detail: `HTTP ${resp.status} (expected ${expected.join('/')})` };
  } catch (err) {
    return { healthy: false, detail: err.message.substring(0, 100) };
  }
}

async function checkDocker(service) {
  try {
    const { stdout } = await execAsync(
      `docker inspect --format '{{.State.Status}}|||{{.State.Running}}|||{{.RestartCount}}' "${service.container}" 2>/dev/null`,
      { timeout: 5000 }
    );
    const [status, running, restarts] = stdout.trim().split('|||');

    if (running === 'true') {
      return { healthy: true, detail: `running (restarts: ${restarts})` };
    }
    return { healthy: false, detail: `status: ${status}, restarts: ${restarts}` };
  } catch (err) {
    return { healthy: false, detail: `container not found or Docker error` };
  }
}

async function checkService(service) {
  if (service.type === 'http') return await checkHTTP(service);
  if (service.type === 'docker') return await checkDocker(service);
  return { healthy: false, detail: 'unknown check type' };
}

// ============================================================
// SELF-HEALING
// ============================================================

async function attemptRestart(service) {
  if (!service.container) {
    return { success: false, detail: 'no container name configured' };
  }

  try {
    await execAsync(`docker restart "${service.container}"`, { timeout: 30000 });
    // Wait a moment for the service to come up
    await new Promise(r => setTimeout(r, 5000));
    // Verify it's actually running now
    const check = await checkService(service);
    return { success: check.healthy, detail: check.detail };
  } catch (err) {
    return { success: false, detail: err.message.substring(0, 100) };
  }
}

// ============================================================
// MAIN HEARTBEAT CYCLE
// ============================================================

export async function runHeartbeat(sockRef) {
  const state = await loadState();
  const now = new Date().toISOString();
  state.lastRun = now;

  const alerts = [];
  const recoveries = [];

  for (const service of DEFAULT_SERVICES) {
    // Initialize state for this service if needed
    if (!state.services[service.name]) {
      state.services[service.name] = {
        consecutiveFailures: 0,
        lastHealthy: null,
        lastFailed: null,
        lastRestart: null,
        lastAlerted: null,
        status: 'unknown',
      };
    }

    const svcState = state.services[service.name];
    const result = await checkService(service);

    if (result.healthy) {
      // Service is healthy
      if (svcState.consecutiveFailures > 0) {
        // It was failing but recovered
        if (svcState.consecutiveFailures >= ALERT_THRESHOLD) {
          recoveries.push(`${service.name} recovered (was down for ${svcState.consecutiveFailures} checks)`);
        }
        svcState.consecutiveFailures = 0;
      }
      svcState.lastHealthy = now;
      svcState.status = 'healthy';
    } else {
      // Service is unhealthy
      svcState.consecutiveFailures++;
      svcState.lastFailed = now;
      svcState.status = 'failing';

      console.log(`💔 ${service.name}: failure #${svcState.consecutiveFailures} — ${result.detail}`);

      // Attempt auto-restart after threshold
      if (
        service.autoRestart &&
        svcState.consecutiveFailures === RESTART_THRESHOLD
      ) {
        const timeSinceLastRestart = svcState.lastRestart
          ? Date.now() - new Date(svcState.lastRestart).getTime()
          : Infinity;

        if (timeSinceLastRestart > RESTART_COOLDOWN_MS) {
          console.log(`🔄 Auto-restarting ${service.name}...`);
          const restart = await attemptRestart(service);
          svcState.lastRestart = now;

          if (restart.success) {
            console.log(`✅ ${service.name} auto-restarted successfully`);
            svcState.consecutiveFailures = 0;
            svcState.status = 'healthy';
            svcState.lastHealthy = now;
            recoveries.push(`${service.name} auto-healed (restarted container)`);
            continue;
          } else {
            console.log(`❌ ${service.name} restart failed: ${restart.detail}`);
          }
        }
      }

      // Alert Gil if failures exceed alert threshold (and we haven't alerted recently)
      if (svcState.consecutiveFailures >= ALERT_THRESHOLD) {
        const timeSinceLastAlert = svcState.lastAlerted
          ? Date.now() - new Date(svcState.lastAlerted).getTime()
          : Infinity;

        // Don't spam alerts — at most once per 30 minutes per service
        if (timeSinceLastAlert > 30 * 60 * 1000) {
          const restartNote = service.autoRestart
            ? `Auto-restart was attempted but failed.`
            : `Auto-restart is disabled for this service.`;

          alerts.push(
            `${service.name}: DOWN for ${svcState.consecutiveFailures} consecutive checks\n` +
            `Detail: ${result.detail}\n` +
            `${restartNote}`
          );
          svcState.lastAlerted = now;
        }
      }
    }
  }

  await saveState(state);

  // Send alerts to Gil
  if (alerts.length > 0) {
    const msg = `🚨 Service Alert\n\n${alerts.join('\n\n')}\n\nI'll keep monitoring and alert you if anything changes.`;
    try {
      await sockRef.sock.sendMessage(ADMIN_JID, { text: msg });
      console.log(`🚨 Sent ${alerts.length} service alert(s)`);
    } catch (err) {
      console.error('Failed to send heartbeat alert:', err.message);
    }
  }

  // Send recovery notifications
  if (recoveries.length > 0) {
    const msg = `✅ Service Recovery\n\n${recoveries.join('\n')}`;
    try {
      await sockRef.sock.sendMessage(ADMIN_JID, { text: msg });
      console.log(`✅ Sent recovery notification`);
    } catch (err) {
      console.error('Failed to send recovery notification:', err.message);
    }
  }
}

// ============================================================
// STATUS REPORT
// ============================================================

export async function getHeartbeatStatus() {
  const state = await loadState();
  const lines = ['💓 Heartbeat Status\n'];

  for (const service of DEFAULT_SERVICES) {
    const svcState = state.services[service.name];
    if (!svcState) {
      lines.push(`${service.name}: not yet checked`);
      continue;
    }

    const icon = svcState.status === 'healthy' ? '✅' :
                 svcState.status === 'failing' ? '❌' : '❓';
    const lastOk = svcState.lastHealthy
      ? new Date(svcState.lastHealthy).toLocaleTimeString()
      : 'never';

    let detail = `${icon} ${service.name}: ${svcState.status}`;
    if (svcState.consecutiveFailures > 0) {
      detail += ` (${svcState.consecutiveFailures} failures)`;
    }
    detail += ` | last OK: ${lastOk}`;
    if (service.autoRestart) detail += ' | auto-restart: on';

    lines.push(detail);
  }

  if (state.lastRun) {
    lines.push(`\nLast check: ${new Date(state.lastRun).toLocaleTimeString()}`);
  }

  return lines.join('\n');
}

// ============================================================
// MANAGEMENT — Add/remove services dynamically
// ============================================================

export function getMonitoredServices() {
  return DEFAULT_SERVICES.map(s => ({
    name: s.name,
    type: s.type,
    url: s.url || null,
    container: s.container || null,
    autoRestart: s.autoRestart,
  }));
}
