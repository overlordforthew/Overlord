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
import { logRegression, logFriction } from './meta-learning.js';
import { recordGap } from './pulse.js';
import { analyzeError, buildEnrichedNextAction } from './error-analyzer.js';

const execAsync = promisify(exec);
const logger = pino({ level: 'info' });

// Debounce: 10-minute cooldown per container to prevent cascading tasks
const cooldowns = new Map(); // container -> timestamp
const COOLDOWN_MS = 10 * 60 * 1000;

// Containers to ignore (Coolify restart cycles, planned restarts)
const IGNORED_CONTAINERS = new Set([
  'coolify-sentinel', // Coolify's own health check restarter
]);

// Coolify UUIDs to ignore — these are Coolify-managed and can't be repaired by Overlord
const IGNORED_COOLIFY_UUIDS = new Set([
  'okw0cwwgskcow8k8o08gsok0', // Lumina (Coolify-managed, persistent crash-loop)
]);

// Known project containers — only alert on containers we actually manage
const KNOWN_PREFIXES = [
  'overlord', 'namibarden', 'surfababe', 'mastercommander', 'lumina',
  'onlyhulls', 'shannon', 'seneca', 'coolify', 'beszel', 'glances',
  'qdrant', 'searxng', 'claude-proxy', 'hl-dashboard', 'lightpanda',
  'beastmode', 'elmo', 'surfagent', 'hl-blessings', 'hl-grid',
];
const EPHEMERAL_CONTAINER_PATTERNS = [
  /^beastmode-(?:.+-)?test(?:-[a-z0-9-]+)?$/i,
  /^beastmode-(?:.+-)?pg-test(?:-[a-z0-9-]+)?$/i,
  /^beastmode-(?:.+-)?pg-[0-9]+$/i,
];

function isKnownContainer(name) {
  // Match known prefixes (e.g. "overlord", "overlord-db", "lumina-app-1")
  if (KNOWN_PREFIXES.some(p => name.startsWith(p))) return true;
  // Match Coolify-deployed containers (UUID-style names)
  if (/^[a-z0-9]{24,}-\d+$/.test(name)) return true;
  if (/^(app|db)-[a-z0-9]{24,}-\d+$/.test(name)) return true;
  return false;
}

function isEphemeralContainer(name) {
  return EPHEMERAL_CONTAINER_PATTERNS.some((pattern) => pattern.test(name));
}

let createRepairTask = null; // Injected callback
let sockRef = null;

export function initErrorWatcher(taskCreator, sock) {
  createRepairTask = taskCreator;
  sockRef = sock;
}

// Normalize Coolify container names: strip the timestamp suffix so
// db-okw0cwwgskcow8k8o08gsok0-122041472130 → db-okw0cwwgskcow8k8o08gsok0
// This prevents each Coolify-recreated incarnation from bypassing cooldown
function normalizeName(container) {
  return container.replace(/-\d{9,}$/, '');
}

function isOnCooldown(container) {
  const key = normalizeName(container);
  const last = cooldowns.get(key);
  if (!last) return false;
  return (Date.now() - last) < COOLDOWN_MS;
}

function setCooldown(container) {
  cooldowns.set(normalizeName(container), Date.now());
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
      if (isEphemeralContainer(container)) continue;
      // Skip Coolify-managed containers we can't repair
      const coolifyUuid = container.match(/^(?:app|db)-([a-z0-9]{24,})-\d+$/)?.[1];
      if (coolifyUuid && IGNORED_COOLIFY_UUIDS.has(coolifyUuid)) continue;
      if (!isKnownContainer(container)) {
        logger.info({ container, event, exitCode }, 'Ignoring unknown/ephemeral container');
        continue;
      }
      if (exitCode === 0) continue; // Normal shutdown, not a crash
      if (exitCode === 143) continue; // SIGTERM — intentional stop (Coolify deploys, manual stop), not a crash
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

        // Feed learning systems
        logRegression('infrastructure', `Container ${container} crashed (${event}, exit ${exitCode})`, null, `Monitor ${container} health and restart triggers`).catch(() => {});
        recordGap('infrastructure', `Container ${container} crash: ${event}`, `Exit code ${exitCode}`);
        logFriction('container_crash', `${container} ${event} exit=${exitCode}`, 0).catch(() => {});

        try {
          // AI-powered crash analysis for better repair context
          const baseAction = `Container "${container}" crashed with ${event} (exit code ${exitCode}). Check docker logs, identify root cause, restart if needed, verify recovery.`;
          let nextAction = baseAction;
          let priority = 'high';
          try {
            const crashInfo = `${event} (exit code ${exitCode})`;
            const analysis = await analyzeError(container, crashInfo);
            if (analysis.rootCause !== 'Analysis unavailable') {
              nextAction = buildEnrichedNextAction(container, crashInfo, analysis, baseAction);
              if (analysis.severity === 'critical') priority = 'urgent';
            }
          } catch { /* analysis is best-effort */ }

          await createRepairTask({
            title: `Auto-repair: ${container} ${event} (exit ${exitCode})`,
            kind: 'repair',
            project: container,
            chatJid: `${process.env.ADMIN_NUMBER}@s.whatsapp.net`,
            owner: 'error-watcher',
            priority,
            riskLevel: 'low',
            successCriteria: `Container ${container} running and healthy`,
            nextAction,
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

        // Feed learning systems
        logRegression('infrastructure', `5xx spike: ${backend} ${count}x HTTP ${status}`, null, `Monitor ${backend} health`).catch(() => {});
        recordGap('performance', `Backend ${backend} 5xx spike`, `${count}x HTTP ${status} in 2min`);
        logFriction('5xx_spike', `${backend} ${count}x ${status}`, 0).catch(() => {});

        // AI-powered 5xx analysis
        const baseAction = `Detected ${count} HTTP ${status} errors for backend "${backend}" in last 2 minutes. Check container logs, check if container is running, check Traefik routing config, fix and verify.`;
        let nextAction = baseAction;
        let priority = 'medium';
        try {
          const errorInfo = `${count}x HTTP ${status} errors in 2 minutes`;
          const analysis = await analyzeError(backend, errorInfo);
          if (analysis.rootCause !== 'Analysis unavailable') {
            nextAction = buildEnrichedNextAction(backend, errorInfo, analysis, baseAction);
            if (analysis.severity === 'critical') priority = 'urgent';
            else if (analysis.severity === 'high') priority = 'high';
          }
        } catch { /* analysis is best-effort */ }

        await createRepairTask({
          title: `Auto-repair: ${backend} 5xx spike (${count}x HTTP ${status})`,
          kind: 'repair',
          project: backend,
          chatJid: `${process.env.ADMIN_NUMBER}@s.whatsapp.net`,
          owner: 'error-watcher',
          priority,
          riskLevel: 'low',
          successCriteria: `${backend} returning 200 OK`,
          nextAction,
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
