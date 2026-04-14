#!/usr/bin/env node
/**
 * DB Error Monitor
 * Watches all PostgreSQL container logs, logs errors to file, intelligently alerts
 * Only alerts on recurring errors (3+ occurrences within 1 hour)
 */

import { exec } from 'child_process';
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { promisify } from 'util';

const execAsync = promisify(exec);

const ERROR_LOG = '/root/logs/db-errors.jsonl';
const ERROR_THRESHOLD = 3;  // Alert after 3 occurrences
const TIME_WINDOW = 3600000; // 1 hour in ms
const CHECK_INTERVAL = 5000; // Check logs every 5 seconds

// In-memory tracking of errors
const errorTracker = new Map(); // key: error hash, value: { count, timestamps, container, severity }

// Ensure log directory exists
mkdirSync('/root/logs', { recursive: true });

// Initialize log file
if (!existsSync(ERROR_LOG)) {
  appendFileSync(ERROR_LOG, '');
}

function hashError(error, container) {
  // Create a consistent hash of error pattern (ignoring variable parts like PIDs, timestamps)
  const simplified = error
    .replace(/\[\d+\]/g, '[PID]')  // Replace PIDs
    .replace(/\d{4}-\d{2}-\d{2}T?\d{2}:\d{2}:\d{2}/g, '[TIME]')  // Replace timestamps
    .replace(/'[^']*'/g, "'VALUE'")  // Replace quoted values
    .toLowerCase();
  return `${container}::${simplified}`;
}

function logError(container, severity, message, raw) {
  const entry = {
    timestamp: new Date().toISOString(),
    container,
    severity,
    message: message.substring(0, 200),  // Keep it reasonable
    hash: hashError(message, container),
  };

  appendFileSync(ERROR_LOG, JSON.stringify(entry) + '\n');
  return entry;
}

async function shouldAlert(hash, container, severity) {
  const now = Date.now();

  if (!errorTracker.has(hash)) {
    errorTracker.set(hash, {
      count: 1,
      timestamps: [now],
      container,
      severity,
      lastAlert: 0,
    });
    return false;
  }

  const tracker = errorTracker.get(hash);

  // Remove timestamps older than 1 hour
  tracker.timestamps = tracker.timestamps.filter(t => now - t < TIME_WINDOW);
  tracker.timestamps.push(now);
  tracker.count = tracker.timestamps.length;

  // Alert if 3+ occurrences AND haven't alerted in last 30 minutes
  const timeSinceLastAlert = now - tracker.lastAlert;
  if (tracker.count >= ERROR_THRESHOLD && timeSinceLastAlert > 1800000) {
    tracker.lastAlert = now;
    return true;
  }

  return false;
}

async function monitorContainer(container) {
  try {
    // Get logs from last 30 seconds
    const { stdout } = await execAsync(
      `docker logs --since 30s --timestamps ${container} 2>&1 | tail -50`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    const lines = stdout.split('\n');

    for (const line of lines) {
      if (!line) continue;

      // Match error patterns
      let severity = null;
      let message = null;

      if (line.includes('FATAL') || line.includes('PANIC')) {
        severity = 'FATAL';
        message = line.substring(line.indexOf('FATAL') || line.indexOf('PANIC'));
      } else if (line.includes('ERROR')) {
        severity = 'ERROR';
        message = line.substring(line.indexOf('ERROR'));
      } else if (line.includes('WARN')) {
        severity = 'WARN';
        message = line.substring(line.indexOf('WARN'));
      }

      if (severity && message) {
        const entry = logError(container, severity, message, line);
        const shouldAlertUser = await shouldAlert(entry.hash, container, severity);

        if (shouldAlertUser) {
          const tracker = errorTracker.get(entry.hash);
          console.log(`🚨 ALERT: ${container} — ${severity} (${tracker.count} times in 1hr)`);
          console.log(`Message: ${message.substring(0, 100)}`);
        }
      }
    }
  } catch (e) {
    // Silently ignore if container doesn't exist
  }
}

async function main() {
  console.log('🗂️ DB Error Monitor started');
  console.log(`📝 Logging to: ${ERROR_LOG}`);
  console.log(`⚠️ Alert threshold: ${ERROR_THRESHOLD} errors per hour\n`);

  // Get all postgres containers
  const getContainers = async () => {
    try {
      const { stdout } = await execAsync(
        'docker ps --filter "ancestor=postgres:17-alpine" --filter "ancestor=postgres:16-alpine" --filter "ancestor=postgres:15-alpine" --format "{{.Names}}"'
      );
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };

  // Monitor loop
  setInterval(async () => {
    const containers = await getContainers();
    for (const container of containers) {
      await monitorContainer(container);
    }
  }, CHECK_INTERVAL);
}

main().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n✅ DB Error Monitor stopped');
  process.exit(0);
});
