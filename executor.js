/**
 * Executor — Autonomous task execution engine
 *
 * Runs tasks without waiting for user messages.
 * Has its own Claude CLI spawner — no dependency on index.js.
 *
 * Used by:
 *   - Observer (auto-repair detected issues)
 *   - Scheduler (proactive background tasks)
 *   - Admin commands (/task run <id>)
 */

import { spawn } from 'child_process';
import {
  updateTask, addTaskEvent, closeTask, getTask, TaskStatus,
} from './task-store.js';
import { setChatState, clearChatState } from './state-store.js';
import { logRegression } from './meta-learning.js';

const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;
const CLAUDE_PATH = process.env.CLAUDE_PATH || 'claude';

// Signals for parsing Claude's response
const SUCCESS_SIGNALS = /✅|done|completed|fixed|deployed|restarted|resolved|working|verified|live now|success|all good|looks good/i;
const BLOCKED_SIGNALS = /blocked|can't proceed|need your input|need approval|need confirmation|permission denied|not sure how|stuck on|unclear|don't have access|cannot access/i;
const CONFIRMATION_REQUEST = /want me to|should i|shall i|do you want|need approval|confirm before|proceed\?|want me to proceed/i;

// ============================================================
// CLAUDE SPAWNER (self-contained — no index.js dependency)
// ============================================================

/**
 * Invoke Claude CLI autonomously with a task prompt.
 * Returns the text response or throws.
 */
async function runClaudeForTask(prompt, workDir = '/projects', timeoutMs = 600_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const args = [
      '-p', '--output-format', 'json',
      '--max-turns', '50',
      '--model', 'claude-opus-4-6',
    ];

    const proc = spawn(CLAUDE_PATH, args, {
      cwd: workDir,
      timeout: timeoutMs,
      env: {
        ...process.env,
        TERM: 'dumb',
        NODE_OPTIONS: '--max-old-space-size=1024',
        CLAUDE_CODE_MAX_OUTPUT_TOKENS: '16000',
      },
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve((parsed.result || '').trim() || stdout.trim());
        } catch {
          resolve(stdout.trim());
        }
      } else if (code === 0) {
        resolve('(no output)');
      } else {
        reject(new Error(`Claude exited ${code}: ${stderr.substring(0, 300)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Spawn failed: ${err.message}`));
    });
  });
}

// ============================================================
// VERIFICATION
// ============================================================

async function verifyUrl(url, timeoutMs = 20000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Overlord-Verify/1.0' },
    });
    clearTimeout(timer);
    if (resp.ok) return { ok: true };
    return { ok: false, error: `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ============================================================
// NOTIFICATION HELPERS
// ============================================================

async function safeSend(sockRef, chatJid, text) {
  try {
    if (sockRef?.sock) {
      await sockRef.sock.sendMessage(chatJid, { text });
    }
  } catch (err) {
    console.error('[Executor] Send failed:', err.message);
  }
}

// ============================================================
// TASK PROMPT BUILDER
// ============================================================

function buildTaskPrompt(task) {
  const lines = [
    `[AUTONOMOUS TASK ${task.id}]`,
    `Title: ${task.title}`,
    `Kind: ${task.kind}`,
  ];

  if (task.project) lines.push(`Project: ${task.project}`);
  if (task.successCriteria) lines.push(`Success criteria: ${task.successCriteria}`);
  if (task.nextAction) lines.push(`Specific action: ${task.nextAction}`);

  if (task.retryCount > 0 && task.lastResult) {
    lines.push(`\nThis is retry #${task.retryCount} (budget: ${task.retryBudget}).`);
    lines.push(`Previous attempt result: ${task.lastResult}`);
    lines.push(`Try a different approach than before.`);
  }

  lines.push('\nInstructions:');
  lines.push('- Execute this task now. Act autonomously — do not ask for permission unless the action is destructive or irreversible.');
  lines.push('- For deploys: run the deploy, wait, verify the URL responds.');
  lines.push('- For repairs: check logs, find the root cause, fix it, verify it works.');
  lines.push('- If you need Gil\'s approval for something destructive, say exactly: "Need approval: [describe what needs approving and why]"');
  lines.push('- End your response with a clear summary: what you did, what succeeded, what (if anything) still needs attention.');

  return lines.join('\n');
}

// ============================================================
// CORE EXECUTOR
// ============================================================

/**
 * Execute a task autonomously.
 *
 * @param {object} task - Task from task-store
 * @param {object} sockRef - { sock } for WhatsApp notifications
 * @returns {Promise<{ status: string, result?: string, error?: string }>}
 */
export async function executeTaskAutonomously(task, sockRef) {
  const chatJid = task.chatJid || ADMIN_JID;

  try {
    // Mark in_progress
    await updateTask(task.id, {
      status: TaskStatus.IN_PROGRESS,
      startedAt: new Date().toISOString(),
    });
    await addTaskEvent(task.id, { type: 'started', description: 'Autonomous execution started' });

    // Notify for observer-triggered tasks
    if (task.source === 'observer') {
      await safeSend(sockRef, chatJid, `🔧 Auto-investigating: ${task.title}`);
    }

    const prompt = buildTaskPrompt(task);

    let responseText;
    try {
      responseText = await runClaudeForTask(prompt);
    } catch (err) {
      await addTaskEvent(task.id, { type: 'claude_error', description: err.message });

      // Retry if budget allows
      const retryCount = (task.retryCount || 0) + 1;
      if (retryCount < task.retryBudget) {
        await updateTask(task.id, {
          status: TaskStatus.NEW,
          retryCount,
          lastResult: `Claude invocation failed: ${err.message}`,
        });
        await new Promise(r => setTimeout(r, 15000));
        const updatedTask = await getTask(task.id);
        return executeTaskAutonomously(updatedTask, sockRef);
      }

      await closeTask(task.id, TaskStatus.BLOCKED, `Claude failed: ${err.message}`);
      logRegression(
        'claude_error',
        `Task "${task.title}": ${err.message.substring(0, 150)}`,
        'Task abandoned after retry budget exhausted',
        `If Claude spawn fails for "${task.kind}" tasks: check server memory, session state, or simplify the task prompt`
      ).catch(() => {});
      await safeSend(sockRef, chatJid,
        `❌ Task failed (Claude error): *${task.title}*\n\n${err.message}`
      );
      return { status: 'error', error: err.message };
    }

    await addTaskEvent(task.id, {
      type: 'completed',
      description: 'Claude execution finished',
      result: responseText.substring(0, 500),
    });

    // Parse result for state signals
    const needsApproval = CONFIRMATION_REQUEST.test(responseText) || /need approval:/i.test(responseText);
    const isBlocked = BLOCKED_SIGNALS.test(responseText) && !SUCCESS_SIGNALS.test(responseText);

    if (needsApproval) {
      await updateTask(task.id, {
        status: TaskStatus.WAITING_USER,
        lastResult: responseText.substring(0, 400),
        awaitingApproval: true,
      });
      // Only take over chat state if no other task is currently active
      const currentState = await import('./state-store.js').then(m => m.getChatState(chatJid));
      if (!currentState.activeTaskId || currentState.activeTaskId === task.id) {
        await setChatState(chatJid, {
          activeTaskId: task.id,
          awaitingConfirmation: true,
          lastQuestion: responseText.substring(0, 300),
        });
        await safeSend(sockRef, chatJid,
          `⏳ *Task paused — needs your input:*\n\n${task.title}\n\n${responseText.substring(0, 500)}`
        );
      } else {
        // Another task owns the active slot — notify with manual resume hint so this task isn't lost
        await safeSend(sockRef, chatJid,
          `⏳ *Task waiting for approval (background):*\n\n${task.title}\n\n${responseText.substring(0, 400)}\n\n_Reply \`/task run ${task.id}\` when ready to resume._`
        );
      }
      return { status: 'waiting', result: responseText };
    }

    if (isBlocked) {
      await updateTask(task.id, {
        status: TaskStatus.BLOCKED,
        blockedReason: responseText.substring(0, 300),
        lastResult: responseText.substring(0, 300),
      });
      logRegression(
        'task_blocked',
        `Task "${task.title}" (${task.kind}): ${responseText.substring(0, 150)}`,
        'Task marked blocked, needs manual intervention or clearer context',
        `For "${task.kind}" tasks that block: provide more specific success criteria or break into smaller steps`
      ).catch(() => {});
      await safeSend(sockRef, chatJid,
        `🚫 *Task blocked:* ${task.title}\n\n${responseText.substring(0, 400)}`
      );
      return { status: 'blocked', result: responseText };
    }

    // Verify URL if configured
    if (task.verificationUrl) {
      await updateTask(task.id, { status: TaskStatus.VERIFYING });
      await addTaskEvent(task.id, { type: 'verifying', description: `Checking ${task.verificationUrl}` });

      // Wait a moment for services to come up
      await new Promise(r => setTimeout(r, 15000));
      const verified = await verifyUrl(task.verificationUrl);

      if (!verified.ok) {
        const retryCount = (task.retryCount || 0) + 1;
        if (retryCount < task.retryBudget) {
          await updateTask(task.id, {
            status: TaskStatus.NEW,
            retryCount,
            lastResult: `${responseText.substring(0, 200)} — verification failed: ${verified.error}`,
            nextAction: `Previous attempt seemed to complete but ${task.verificationUrl} returned ${verified.error}. Try a different fix.`,
          });
          await addTaskEvent(task.id, {
            type: 'retry',
            description: `Verification failed, retrying (${retryCount}/${task.retryBudget})`,
            error: verified.error,
          });
          await new Promise(r => setTimeout(r, 20000));
          const updatedTask = await getTask(task.id);
          return executeTaskAutonomously(updatedTask, sockRef);
        }

        await closeTask(task.id, TaskStatus.BLOCKED,
          `Verification failed after ${retryCount} attempts: ${verified.error}`
        );
        logRegression(
          'deploy_verify',
          `Task "${task.title}": ${task.verificationUrl} → ${verified.error} (after ${retryCount} attempts)`,
          'Task exhausted retry budget without successful URL verification',
          `After deploy of "${task.title}" fails verification: check container startup time, port binding, or Traefik routing before retrying`
        ).catch(() => {});
        await safeSend(sockRef, chatJid,
          `❌ *Task failed:* ${task.title}\n\nVerification: ${task.verificationUrl} → ${verified.error}\nAfter ${retryCount} attempts.`
        );
        return { status: 'failed', result: responseText };
      }

      await addTaskEvent(task.id, {
        type: 'verified',
        description: `${task.verificationUrl} responding OK`,
      });
    }

    // Done
    await closeTask(task.id, TaskStatus.DONE, responseText.substring(0, 400));
    // Only clear activeTaskId if we own it — don't wipe an unrelated active task
    const stateAtDone = await import('./state-store.js').then(m => m.getChatState(chatJid));
    if (stateAtDone.activeTaskId === task.id) {
      await setChatState(chatJid, {
        activeTaskId: null,
        awaitingConfirmation: false,
        lastActionTaken: `Completed: ${task.title}`,
      });
    }

    // Notify on background/observer tasks
    if (task.source === 'observer' || task.source === 'scheduler') {
      const verifyNote = task.verificationUrl ? `\n✅ ${task.verificationUrl} verified` : '';
      await safeSend(sockRef, chatJid,
        `✅ *Done:* ${task.title}${verifyNote}\n\n${responseText.substring(0, 400)}`
      );
    }

    return { status: 'done', result: responseText };

  } catch (err) {
    console.error('[Executor] Unexpected error:', err);
    await addTaskEvent(task.id, { type: 'error', description: 'Unexpected error', error: err.message });
    await updateTask(task.id, { status: TaskStatus.BLOCKED, blockedReason: err.message });
    return { status: 'error', error: err.message };
  }
}

/**
 * Schedule an HTTP verification check after a user-triggered deploy.
 * Sends a WhatsApp confirmation when done.
 */
export async function scheduleVerification(url, taskId, taskTitle, chatJid, sockRef, delayMs = 30000) {
  setTimeout(async () => {
    try {
      const result = await verifyUrl(url);
      if (result.ok) {
        if (taskId) await closeTask(taskId, TaskStatus.DONE, `Verified: ${url} responding OK`);
        await safeSend(sockRef, chatJid, `✅ Verified: ${url} is live and responding.`);
      } else {
        await safeSend(sockRef, chatJid,
          `⚠️ Verification check: ${url} → ${result.error}\nMight need another look.`
        );
      }
    } catch (err) {
      console.error('[Executor] Verification check error:', err.message);
    }
  }, delayMs);
}

/**
 * Create and immediately execute a task.
 * Convenience wrapper for observer/scheduler use.
 */
export async function createAndExecuteTask(taskParams, sockRef) {
  const { createTask } = await import('./task-store.js');
  const task = await createTask(taskParams);
  // Execute in background — don't await so caller returns immediately
  executeTaskAutonomously(task, sockRef).catch(err => {
    console.error('[Executor] Background task error:', err.message);
  });
  return task;
}
