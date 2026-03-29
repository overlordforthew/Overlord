/**
 * Work Queue — Process-isolated task execution with memory limits
 *
 * Heavy (complex) tasks run sequentially in memory-limited subprocesses.
 * Light tasks (simple/medium) still run inline but with cgroup limits.
 *
 * OpenCrow-inspired pattern: isolate heavy work so it can't take down
 * the main WhatsApp connection.
 */

import { spawn, execSync } from 'child_process';
import os from 'os';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Memory limits per task type
const MEMORY_LIMITS = {
  simple:  512,   // 512 MB
  medium:  768,   // 768 MB
  complex: 1200,  // 1.2 GB — still leaves headroom for bot + OS
};

// Check if systemd-run can actually create scopes (not just if binary exists)
let hasSystemdRun = false;
try {
  execSync('systemd-run --scope --quiet -p MemoryMax=100M true', { stdio: 'pipe', timeout: 5000 });
  hasSystemdRun = true;
} catch {
  // Not available (e.g., inside Docker without systemd as init)
}

// ============================================================
// SEQUENTIAL WORK QUEUE
// ============================================================

class WorkQueue {
  constructor() {
    this.queue = [];        // { id, resolve, reject, spawnFn, chatJid, taskType }
    this.running = null;    // Currently executing item
    this.stats = { queued: 0, completed: 0, failed: 0, killed: 0 };
  }

  get length() { return this.queue.length; }
  get isRunning() { return this.running !== null; }

  /**
   * Add a heavy task to the queue. Returns a promise that resolves
   * when the task completes (or rejects on failure).
   */
  enqueue(chatJid, taskType, spawnFn) {
    const id = `wq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.stats.queued++;

    return new Promise((resolve, reject) => {
      this.queue.push({ id, chatJid, taskType, spawnFn, resolve, reject });
      logger.info({ id, chatJid, taskType, queueLen: this.queue.length }, 'Task queued');
      this._processNext();
    });
  }

  async _processNext() {
    if (this.running || this.queue.length === 0) return;

    const item = this.queue.shift();
    this.running = item;

    logger.info({ id: item.id, chatJid: item.chatJid, taskType: item.taskType, remaining: this.queue.length }, 'Processing queued task');

    try {
      const result = await item.spawnFn();
      this.stats.completed++;
      item.resolve(result);
    } catch (err) {
      this.stats.failed++;
      item.reject(err);
    } finally {
      this.running = null;
      // Process next item after a brief pause (let GC breathe)
      if (this.queue.length > 0) {
        setTimeout(() => this._processNext(), 2000);
      }
    }
  }

  /**
   * Get queue status for /status command
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      isRunning: !!this.running,
      runningChat: this.running?.chatJid || null,
      runningType: this.running?.taskType || null,
      stats: { ...this.stats },
      waiting: this.queue.map(q => ({
        id: q.id,
        chatJid: q.chatJid,
        taskType: q.taskType,
      })),
    };
  }

  /**
   * Cancel all queued items for a specific chat
   */
  cancelForChat(chatJid) {
    const removed = this.queue.filter(q => q.chatJid === chatJid);
    this.queue = this.queue.filter(q => q.chatJid !== chatJid);
    for (const item of removed) {
      item.reject(new Error('Cancelled'));
      this.stats.killed++;
    }
    return removed.length;
  }
}

// Singleton queue for heavy tasks
export const heavyQueue = new WorkQueue();

// ============================================================
// GLOBAL CLAUDE CONCURRENCY GATE
// ============================================================
// Memory-aware concurrency: allow 2 concurrent Claude processes when
// there's enough headroom, but serialize when memory is tight.
// On a 4GB container, two simple/medium processes (~512-768MB each)
// fit fine, but two complex ones (~1.2GB each) or a spike will OOM.

let _activeClaudeCount = 0;
const _claudeWaiters = [];
const MAX_CONCURRENT = 2;
const MIN_FREE_FOR_SECOND = 1500 * 1024 * 1024; // 1.5 GB free required to allow a second process

export function withGlobalClaudeLock(fn) {
  return new Promise((outerResolve, outerReject) => {
    const tryRun = async () => {
      _activeClaudeCount++;
      try {
        const result = await fn();
        outerResolve(result);
      } catch (err) {
        outerReject(err);
      } finally {
        _activeClaudeCount--;
        // Wake next waiter if any
        if (_claudeWaiters.length > 0) {
          const next = _claudeWaiters.shift();
          next();
        }
      }
    };

    if (_activeClaudeCount < MAX_CONCURRENT && os.freemem() >= MIN_FREE_FOR_SECOND) {
      // Enough slots and memory — run immediately
      tryRun();
    } else if (_activeClaudeCount === 0) {
      // Nothing running — always allow the first process
      tryRun();
    } else {
      // Wait for a slot to open
      logger.info({ active: _activeClaudeCount, freeMB: Math.round(os.freemem() / 1024 / 1024) },
        'Claude concurrency gate: waiting for slot');
      _claudeWaiters.push(tryRun);
    }
  });
}

export function getClaudeConcurrencyStatus() {
  return { active: _activeClaudeCount, waiting: _claudeWaiters.length };
}

// ============================================================
// MEMORY-LIMITED SPAWN
// ============================================================

/**
 * Spawn a process with cgroup memory limits (if available).
 * Falls back to Node.js --max-old-space-size if systemd-run isn't available.
 *
 * @param {string} command - The command to run
 * @param {string[]} args - Command arguments
 * @param {object} opts - spawn options (cwd, env, timeout, etc.)
 * @param {number} memoryMB - Memory limit in MB
 * @returns {ChildProcess}
 */
export function spawnWithMemoryLimit(command, args, opts, memoryMB) {
  if (hasSystemdRun && memoryMB) {
    // Wrap in systemd-run --scope for hard memory limit
    // The kernel OOM-kills this process specifically, not the parent
    const wrappedArgs = [
      '--scope', '--quiet',
      `-p`, `MemoryMax=${memoryMB}M`,
      `-p`, `MemorySwapMax=0`,  // No swap — fail fast
      command,
      ...args,
    ];
    logger.debug({ memoryMB, command }, 'Spawning with cgroup memory limit');
    return spawn('systemd-run', wrappedArgs, opts);
  }

  // No cgroup support — spawn without artificial memory limits.
  // The container mem_limit is the real safety net; V8 heap caps were causing
  // unnecessary SIGKILL failures when Claude CLI needed more memory for large prompts.
  return spawn(command, args, opts);
}

/**
 * Get the recommended memory limit for a task type.
 */
export function getMemoryLimit(taskType) {
  return MEMORY_LIMITS[taskType] || MEMORY_LIMITS.medium;
}

/**
 * Check if a task type should be queued (heavy) vs run inline (light).
 * Complex tasks from non-admin users are always queued.
 * Complex tasks from admin are queued if another heavy task is already running.
 */
export function shouldQueue(taskType, isAdmin) {
  if (taskType === 'complex') return true;
  return false;
}

/**
 * Get system memory pressure info
 */
export function getMemoryPressure() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const pct = Math.round((used / total) * 100);
  return {
    totalMB: Math.round(total / 1024 / 1024),
    freeMB: Math.round(free / 1024 / 1024),
    usedMB: Math.round(used / 1024 / 1024),
    usedPct: pct,
    critical: free < 300 * 1024 * 1024,
  };
}
