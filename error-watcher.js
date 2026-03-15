/**
 * Error Watcher — Auto-detect container crashes and 5xx spikes
 *
 * Two watchers:
 * 1. Docker events: monitors container die/oom events
 * 2. Traefik 5xx: scans access log for error spikes
 *
 * Creates repair tasks via executor when issues are detected.
 */

import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import pino from 'pino';

const execAsync = promisify(exec);
const logger = pino({ level: 'info' });

// Debounce: 10-minute cooldown per container to prevent cascading tasks
const cooldowns = new Map(); // container -> timestamp
const COOLDOWN_MS = 10 * 60 * 1000;

// Containers to ignore (Coolify restart cycles, planned restarts)
const IGNORED_CONTAINERS = new Set([
  'coolify-sentinel', // Coolify's own health check restarter
]);

let createRepairTask = null; // Injected callback
let sockRef = null;

export function initErrorWatcher(taskCreator, sock) {
  createRepairTask = taskCreator;
  sockRef = sock;
}

function isOnCooldown(container) {
  const last = cooldowns.get(container);
  if (!last) return false;
  return (Date.now() - last) < COOLDOWN_MS;
}

function setCooldown(container) {
  cooldowns.set(container, Date.now());
}

// ============================================================
// DOCKER EVENT WATCHER
// ============================================================

let dockerWatcherProc = null;

export function watchDockerEvents() {
  if (!createRepairTask) {
    logger.warn('Error watcher: no task creator set, skipping docker events');
    return;
  }

  // Long-running docker events stream
  dockerWatcherProc = spawn('docker', [
    'events', '--filter', 'event=die', '--filter', 'event=oom',
    '--format', '{{.Actor.Attributes.name}} {{.Action}} {{.Actor.Attributes.exitCode}}'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  dockerWatcherProc.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      const parts = line.trim().split(' ');
      const container = parts[0];
      const event = parts[1];
      const exitCode = parseInt(parts[2]) || 0;

      if (!container || IGNORED_CONTAINERS.has(container)) continue;
      if (exitCode === 0) continue; // Normal shutdown, not a crash
      if (isOnCooldown(container)) continue;

      // Check if container self-recovers within 30s before creating a task
      setTimeout(async () => {
        try {
          const { stdout } = await execAsync(
            `docker inspect --format='{{.State.Running}}' "${container}" 2>/dev/null`,
            { timeout: 5000 }
          );
          if (stdout.trim() === 'true') {
            logger.info({ container, event, exitCode }, 'Container self-recovered, skipping repair');
            return;
          }
        } catch { /* container may not exist anymore */ }

        setCooldown(container);
        logger.warn({ container, event, exitCode }, 'Container crash detected, creating repair task');

        try {
          await createRepairTask({
            title: `Auto-repair: ${container} ${event} (exit ${exitCode})`,
            kind: 'repair',
            project: container,
            chatJid: `${process.env.ADMIN_NUMBER}@s.whatsapp.net`,
            owner: 'error-watcher',
            priority: 'high',
            riskLevel: 'low',
            successCriteria: `Container ${container} running and healthy`,
            nextAction: `Container "${container}" crashed with ${event} (exit code ${exitCode}). Check docker logs, identify root cause, restart if needed, verify recovery.`,
            source: 'observer',
          });
        } catch (err) {
          logger.error({ err: err.message, container }, 'Failed to create repair task for container crash');
        }
      }, 30000);
    }
  });

  dockerWatcherProc.on('error', (err) => {
    logger.error({ err: err.message }, 'Docker events watcher error');
  });

  dockerWatcherProc.on('close', (code) => {
    logger.warn({ code }, 'Docker events watcher closed, restarting in 30s');
    setTimeout(() => watchDockerEvents(), 30000);
  });

  logger.info('👁️ Docker event watcher started');
}

// ============================================================
// TRAEFIK 5XX WATCHER
// ============================================================

const TRAEFIK_ACCESS_LOG = '/data/coolify/proxy/access.log';
let lastTraefikCheck = Date.now();

export async function checkTraefik5xx() {
  if (!createRepairTask) return;

  try {
    const since = new Date(lastTraefikCheck).toISOString();
    lastTraefikCheck = Date.now();

    // Count 5xx errors per backend in the last 2 minutes
    const { stdout } = await execAsync(
      `tail -2000 ${TRAEFIK_ACCESS_LOG} 2>/dev/null | grep -E '"(5[0-9]{2})"' | awk -F'"' '{for(i=1;i<=NF;i++) if($i ~ /^5[0-9]{2}$/) {status=$i}} {split($0,a," "); print a[1], status}' | sort | uniq -c | sort -rn | head -5`,
      { timeout: 10000 }
    );

    if (!stdout.trim()) return;

    const lines = stdout.trim().split('\n');
    for (const line of lines) {
      const match = line.trim().match(/(\d+)\s+(\S+)\s+(\d+)/);
      if (!match) continue;

      const count = parseInt(match[1]);
      const backend = match[2];
      const status = match[3];

      // Spike threshold: >5 5xx errors in 2 min window
      if (count > 5) {
        const key = `traefik-${backend}`;
        if (isOnCooldown(key)) continue;
        setCooldown(key);

        logger.warn({ backend, status, count }, 'Traefik 5xx spike detected');

        await createRepairTask({
          title: `Auto-repair: ${backend} 5xx spike (${count}x HTTP ${status})`,
          kind: 'repair',
          project: backend,
          chatJid: `${process.env.ADMIN_NUMBER}@s.whatsapp.net`,
          owner: 'error-watcher',
          priority: 'medium',
          riskLevel: 'low',
          successCriteria: `${backend} returning 200 OK`,
          nextAction: `Detected ${count} HTTP ${status} errors for backend "${backend}" in last 2 minutes. Check container logs, check if container is running, check Traefik routing config, fix and verify.`,
          source: 'observer',
        });
      }
    }
  } catch (err) {
    // Access log may not exist or be empty — that's fine
    if (!err.message.includes('No such file')) {
      logger.warn({ err: err.message }, 'Traefik 5xx check failed');
    }
  }
}

export function stopDockerWatcher() {
  if (dockerWatcherProc) {
    dockerWatcherProc.kill();
    dockerWatcherProc = null;
  }
}
