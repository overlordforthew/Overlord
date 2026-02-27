/**
 * session-guard.js — Claude Session Watchdog for Overlord
 *
 * Prevents zombie Claude CLI processes from consuming resources.
 * Tracks active sessions, kills hung ones, and reports forced kills.
 *
 * Design principles:
 * - Lightweight: just tracks PIDs and timestamps
 * - Conservative: generous timeout before killing
 * - Transparent: logs every action
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Max time a Claude process can run before being considered hung (ms)
const MAX_SESSION_AGE_MS = 10 * 60 * 1000; // 10 minutes (matches CONFIG.maxResponseTime)

// How often the guard scans for zombies (called externally via cron)
// Active sessions tracked in memory (not persisted — they're transient)
const activeSessions = new Map();

// ============================================================
// SESSION TRACKING
// ============================================================

/**
 * Register a Claude process as active.
 * Call this when spawning a new Claude CLI process.
 */
export function registerSession(chatJid, pid) {
  activeSessions.set(chatJid, {
    pid,
    startedAt: Date.now(),
    chatJid,
  });
}

/**
 * Unregister a completed Claude process.
 * Call this when a Claude CLI process exits normally.
 */
export function unregisterSession(chatJid) {
  activeSessions.delete(chatJid);
}

/**
 * Check if a chat has an active Claude session.
 */
export function hasActiveSession(chatJid) {
  return activeSessions.has(chatJid);
}

/**
 * Get info about all active sessions.
 */
export function getActiveSessions() {
  const now = Date.now();
  return Array.from(activeSessions.entries()).map(([jid, session]) => ({
    chatJid: jid,
    pid: session.pid,
    ageMs: now - session.startedAt,
    ageMin: Math.round((now - session.startedAt) / 60000),
  }));
}

// ============================================================
// ZOMBIE DETECTION & CLEANUP
// ============================================================

/**
 * Scan for and kill hung Claude sessions.
 * Returns array of killed session descriptions.
 */
export async function sweepZombies() {
  const now = Date.now();
  const killed = [];

  for (const [jid, session] of activeSessions) {
    const age = now - session.startedAt;

    if (age > MAX_SESSION_AGE_MS) {
      // Check if the process is actually still running
      try {
        const { stdout } = await execAsync(`kill -0 ${session.pid} 2>&1 && echo ALIVE || echo DEAD`, { timeout: 3000 });

        if (stdout.trim() === 'ALIVE') {
          // Kill it
          try {
            process.kill(session.pid, 'SIGTERM');
            console.log(`🔪 Session guard: killed hung Claude PID ${session.pid} for ${jid} (age: ${Math.round(age / 60000)}min)`);

            // Give it a moment, then force kill if still alive
            setTimeout(async () => {
              try {
                process.kill(session.pid, 'SIGKILL');
              } catch {
                // Already dead, good
              }
            }, 5000);

            killed.push({
              chatJid: jid,
              pid: session.pid,
              ageMin: Math.round(age / 60000),
            });
          } catch (err) {
            // Process already gone
            console.log(`🔪 Session guard: PID ${session.pid} already dead`);
          }
        }
      } catch {
        // Can't check, assume it's gone
      }

      // Either way, clean up the tracking
      activeSessions.delete(jid);
    }
  }

  // Also scan for orphaned claude processes not tracked by us
  try {
    const { stdout } = await execAsync(
      'ps aux | grep "[c]laude.*--output-format" | awk \'{print $2, $10, $11}\'',
      { timeout: 5000 }
    );

    if (stdout.trim()) {
      const lines = stdout.trim().split('\n');
      const trackedPids = new Set(Array.from(activeSessions.values()).map(s => s.pid));

      for (const line of lines) {
        const pid = parseInt(line.split(' ')[0]);
        if (!trackedPids.has(pid)) {
          // Check how long it's been running
          try {
            const { stdout: etimeRaw } = await execAsync(`ps -o etimes= -p ${pid}`, { timeout: 3000 });
            const etime = parseInt(etimeRaw.trim());

            if (etime > MAX_SESSION_AGE_MS / 1000) {
              process.kill(pid, 'SIGTERM');
              console.log(`🔪 Session guard: killed orphaned Claude PID ${pid} (age: ${Math.round(etime / 60)}min)`);
              killed.push({ chatJid: 'orphaned', pid, ageMin: Math.round(etime / 60) });
            }
          } catch {
            // Can't check age, skip
          }
        }
      }
    }
  } catch {
    // ps command failed, not critical
  }

  return killed;
}

// ============================================================
// STATUS
// ============================================================

export function getSessionGuardStatus() {
  const sessions = getActiveSessions();
  if (sessions.length === 0) {
    return '🛡️ Session Guard: No active Claude sessions';
  }

  const lines = ['🛡️ Session Guard — Active Sessions\n'];
  for (const s of sessions) {
    const warning = s.ageMs > MAX_SESSION_AGE_MS * 0.7 ? ' ⚠️ approaching timeout' : '';
    lines.push(`PID ${s.pid}: ${s.ageMin}min old${warning}`);
  }

  return lines.join('\n');
}
