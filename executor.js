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

import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import {
  updateTask, addTaskEvent, closeTask, getTask, getAllTasks, TaskStatus,
} from './task-store.js';
import { setChatState, clearChatState } from './state-store.js';
import { logRegression } from './meta-learning.js';
import { spawnWithMemoryLimit, getMemoryLimit } from './work-queue.js';
import { initFixPatterns, findMatchingPatterns, storeFixPattern, extractFixPattern, formatPatternsForPrompt, recordPatternFailure } from './fix-patterns.js';
import { runTaskWithSDK, isSDKEnabled } from './claude-sdk.js';
import { detectCapabilityGap, markSkillInProgress, buildSkillAcquisitionPrompt, record as pulseRecord } from './pulse.js';
import { generateAndStorePostmortem } from './postmortem.js';
import { getIntelligenceBackend, runAgentIntelligence } from './intelligence-runtime.js';

const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;
const CLAUDE_PATH = process.env.CLAUDE_PATH || 'claude';
const WORKSPACE_ROOT = process.env.OVERLORD_WORKSPACE_ROOT || '/tmp/overlord-workspaces';
const execAsync = promisify(exec);

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
  if (getIntelligenceBackend() !== 'claude') {
    const result = await runAgentIntelligence({
      systemPrompt: '',
      userPrompt: prompt,
      cwd: workDir,
      timeoutMs,
      role: 'task',
      requestedModel: 'claude-opus-4-7',
    });
    return result.text || '(no output)';
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const args = [
      '-p', '--output-format', 'json',
      '--max-turns', '50',
      '--model', 'claude-opus-4-7',
    ];

    // Safe env: don't leak API keys to Claude CLI subprocesses
    const SAFE_KEYS = ['HOME', 'USER', 'PATH', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'HOSTNAME', 'PWD', 'LOGNAME'];
    const safeEnv = {};
    for (const k of SAFE_KEYS) { if (process.env[k]) safeEnv[k] = process.env[k]; }
    safeEnv.TERM = 'dumb';
    safeEnv.NODE_OPTIONS = '--max-old-space-size=1024';
    safeEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '16000';
    safeEnv.HOME = process.env.HOME || '/root';
    safeEnv.PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';

    const proc = spawnWithMemoryLimit(CLAUDE_PATH, args, {
      cwd: workDir,
      timeout: timeoutMs,
      env: safeEnv,
    }, getMemoryLimit('complex'));

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

function truncateVerifierEvidence(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
}

async function verifyCommand(verifier, executionContext) {
  const cwd = verifier.cwd || executionContext.workDir || '/projects';
  try {
    const { stdout, stderr } = await execAsync(verifier.command, {
      cwd,
      timeout: verifier.timeoutMs || 20000,
    });
    const combined = `${stdout || ''}\n${stderr || ''}`.trim();
    if (verifier.expectRegex && !(new RegExp(verifier.expectRegex, 'i')).test(combined)) {
      return {
        ok: false,
        error: verifier.failureMessage || `Command verifier did not match /${verifier.expectRegex}/`,
        evidence: truncateVerifierEvidence(combined),
      };
    }
    if (verifier.expectText && !combined.includes(verifier.expectText)) {
      return {
        ok: false,
        error: verifier.failureMessage || `Command verifier missing expected text: ${verifier.expectText}`,
        evidence: truncateVerifierEvidence(combined),
      };
    }
    return {
      ok: true,
      evidence: truncateVerifierEvidence(combined || verifier.command),
    };
  } catch (err) {
    return {
      ok: false,
      error: verifier.failureMessage || err.message,
      evidence: truncateVerifierEvidence(err.stdout || err.stderr || err.message),
    };
  }
}

function describeVerifier(task) {
  if (task.verificationUrl) return `HTTP check: ${task.verificationUrl}`;
  if (task.verifier?.type === 'http') return `HTTP check: ${task.verifier.url}`;
  if (task.verifier?.type === 'command') return `Command check: ${task.verifier.command}`;
  return null;
}

async function runTaskVerification(task, responseText, executionContext) {
  if (task.verificationUrl) {
    const result = await verifyUrl(task.verificationUrl);
    return {
      ok: result.ok,
      error: result.ok ? null : result.error,
      evidence: result.ok ? `${task.verificationUrl} responded OK` : `${task.verificationUrl} -> ${result.error}`,
    };
  }

  if (task.verifier?.type === 'http') {
    const result = await verifyUrl(task.verifier.url, task.verifier.timeoutMs || 20000);
    return {
      ok: result.ok,
      error: result.ok ? null : result.error,
      evidence: result.ok ? `${task.verifier.url} responded OK` : `${task.verifier.url} -> ${result.error}`,
    };
  }

  if (task.verifier?.type === 'command') {
    return verifyCommand(task.verifier, executionContext);
  }

  if (task.kind === 'repair' && task.source !== 'user') {
    return {
      ok: false,
      error: 'Repair task is missing an explicit verifier',
      evidence: 'No verificationUrl or verifier command configured',
    };
  }

  const mentionsVerification = /\b(verif(y|ied|ication)|health(y)?|responding|confirmed)\b/i.test(responseText || '');
  return {
    ok: mentionsVerification,
    error: mentionsVerification ? null : 'No explicit verification evidence found in task summary',
    evidence: mentionsVerification ? truncateVerifierEvidence(responseText) : 'Summary did not mention verification',
  };
}

// ============================================================
// NOTIFICATION HELPERS
// ============================================================

function splitMessage(text, maxLen = 3900) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = maxLen;
    const para = remaining.lastIndexOf('\n\n', maxLen);
    if (para > maxLen * 0.5) { splitAt = para; }
    else {
      const sent = remaining.lastIndexOf('. ', maxLen);
      if (sent > maxLen * 0.5) { splitAt = sent + 1; }
      else {
        const line = remaining.lastIndexOf('\n', maxLen);
        if (line > maxLen * 0.5) { splitAt = line; }
      }
    }
    chunks.push(remaining.substring(0, splitAt).trimEnd());
    remaining = remaining.substring(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function safeSend(sockRef, chatJid, text) {
  try {
    if (sockRef?.sock) {
      const chunks = splitMessage(text);
      for (let i = 0; i < chunks.length; i++) {
        const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length}) ` : '';
        await sockRef.sock.sendMessage(chatJid, { text: prefix + chunks[i] });
        if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 500));
      }
    }
  } catch (err) {
    console.error('[Executor] Send failed:', err.message);
  }
}

async function pathIsGitRepo(candidate) {
  if (!candidate || !existsSync(candidate)) return false;
  try {
    const { stdout } = await execAsync(`git -C "${candidate}" rev-parse --is-inside-work-tree`, { timeout: 5000 });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

async function resolveTaskRepoPath(task) {
  const directCandidates = [task.repoPath, task.projectPath, task.project]
    .filter(Boolean)
    .filter((value) => value.startsWith?.('/'));

  for (const candidate of directCandidates) {
    if (await pathIsGitRepo(candidate)) return candidate;
  }

  if (!task.project) return null;
  const cleanProject = task.project
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/[^A-Za-z0-9._/-]/g, '');

  const candidates = [
    `/projects/${task.project}`,
    `/projects/${cleanProject}`,
    `/root/projects/${task.project}`,
    `/root/projects/${cleanProject}`,
  ];

  if (/overlord/i.test(task.project)) {
    candidates.unshift('/projects/Overlord', '/root/overlord');
  }

  for (const candidate of [...new Set(candidates)]) {
    if (await pathIsGitRepo(candidate)) return candidate;
  }
  return null;
}

function ensureWorkspaceRoot() {
  if (!existsSync(WORKSPACE_ROOT)) mkdirSync(WORKSPACE_ROOT, { recursive: true });
}

async function prepareExecutionContext(task) {
  const repoPath = await resolveTaskRepoPath(task);
  const defaultWorkDir = task.projectPath || repoPath || '/projects';

  if (task.riskLevel !== 'high') {
    return {
      executor: task.executor || 'container',
      repoPath,
      workDir: defaultWorkDir,
      workspacePath: task.workspacePath || null,
    };
  }

  if (!repoPath) {
    throw new Error('High-risk task requires a git repo path so it can run in an isolated workspace');
  }

  ensureWorkspaceRoot();
  const workspacePath = task.workspacePath || path.join(WORKSPACE_ROOT, task.id);
  if (!existsSync(workspacePath)) {
    await execAsync(`git -C "${repoPath}" worktree add --detach "${workspacePath}" HEAD`, { timeout: 30000 });
  }

  return {
    executor: task.executor || 'repo-worker',
    repoPath,
    workDir: workspacePath,
    workspacePath,
  };
}

// ============================================================
// TASK PROMPT BUILDER
// ============================================================

function buildTaskPrompt(task, executionContext) {
  const lines = [
    `[AUTONOMOUS TASK ${task.id}]`,
    `Title: ${task.title}`,
    `Kind: ${task.kind}`,
    `Executor: ${task.executor || executionContext.executor || 'container'}`,
    `Risk level: ${task.riskLevel || 'low'}`,
  ];

  if (task.project) lines.push(`Project: ${task.project}`);
  if (executionContext.repoPath) lines.push(`Repo path: ${executionContext.repoPath}`);
  if (executionContext.workspacePath) lines.push(`Workspace path: ${executionContext.workspacePath}`);
  if (task.successCriteria) lines.push(`Success criteria: ${task.successCriteria}`);
  if (task.nextAction) lines.push(`Specific action: ${task.nextAction}`);
  const verifierDescription = describeVerifier(task);
  if (verifierDescription) lines.push(`Verifier: ${verifierDescription}`);

  if (task.retryCount > 0 && task.lastResult) {
    lines.push(`\nThis is retry #${task.retryCount} (budget: ${task.retryBudget}).`);
    lines.push(`Previous attempt result: ${task.lastResult}`);
    lines.push(`Try a different approach than before.`);
  }

  lines.push('\nInstructions:');
  lines.push('- Execute this task now. Act autonomously — do not ask for permission unless the action is destructive or irreversible.');
  lines.push('- For deploys: run the deploy, wait, verify the URL responds.');
  lines.push('- For repairs: check logs, find the root cause, fix it, verify it works.');
  lines.push('- Record concrete verification evidence in your summary. A fix is not complete without verification.');
  if (executionContext.workspacePath) {
    lines.push('- This is a HIGH-RISK task. Use only the isolated workspace path above. Do not modify the live source tree directly.');
    lines.push('- If you make code or schema changes, run the narrowest relevant tests/checks in the isolated workspace and include the commit SHA or migration evidence in your summary.');
  }
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
    const executionContext = await prepareExecutionContext(task);

    // Mark in_progress
    await updateTask(task.id, {
      status: TaskStatus.IN_PROGRESS,
      startedAt: new Date().toISOString(),
      executor: executionContext.executor,
      repoPath: executionContext.repoPath || task.repoPath || null,
      workspacePath: executionContext.workspacePath || task.workspacePath || null,
    });
    await addTaskEvent(task.id, { type: 'started', description: 'Autonomous execution started' });
    if (executionContext.workspacePath) {
      await addTaskEvent(task.id, {
        type: 'workspace_prepared',
        description: `Isolated workspace ready at ${executionContext.workspacePath}`,
      });
    }

    // Observer tasks run silently — Gil only wants to hear about failures after retries exhausted

    // Inject known fix patterns for similar issues
    let patternContext = '';
    try {
      await initFixPatterns();
      const symptomText = task.title + ' ' + (task.nextAction || '') + ' ' + (task.lastResult || '');
      const patterns = await findMatchingPatterns(symptomText, task.project);
      if (patterns.length > 0) {
        patternContext = '\n\n' + formatPatternsForPrompt(patterns);
      }
    } catch { /* best effort */ }

    const prompt = buildTaskPrompt(task, executionContext) + patternContext;

    let responseText;
    try {
      // Try Claude SDK path only when Claude is the active backend.
      if (getIntelligenceBackend() === 'claude' && isSDKEnabled()) {
        try {
          const sdkResult = await runTaskWithSDK({ prompt });
          responseText = sdkResult.text;
        } catch (sdkErr) {
          console.warn(`[Executor] SDK path failed, falling back to CLI: ${sdkErr.message}`);
          responseText = await runClaudeForTask(prompt, executionContext.workDir);
        }
      } else {
        responseText = await runClaudeForTask(prompt, executionContext.workDir);
      }
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
      pulseRecord(`task:${task.kind}`, 'down', `${task.title} — ${err.message.substring(0, 150)}`, ['broken-script']);
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
          `⏳ *Task paused — needs your input:*\n\n${task.title}\n\n${responseText}`
        );
      } else {
        // Another task owns the active slot — notify with manual resume hint so this task isn't lost
        await safeSend(sockRef, chatJid,
          `⏳ *Task waiting for approval (background):*\n\n${task.title}\n\n${responseText}\n\n_Reply \`/task run ${task.id}\` when ready to resume._`
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
      // Record pattern failure if we injected patterns that didn't help
      if (patternContext) {
        recordPatternFailure(task.title + ' ' + (task.nextAction || '')).catch(() => {});
      }
      logRegression(
        'task_blocked',
        `Task "${task.title}" (${task.kind}): ${responseText.substring(0, 150)}`,
        'Task marked blocked, needs manual intervention or clearer context',
        `For "${task.kind}" tasks that block: provide more specific success criteria or break into smaller steps`
      ).catch(() => {});
      pulseRecord(`task:${task.kind}`, 'down', `${task.title} — blocked`, []);
      await safeSend(sockRef, chatJid,
        `🚫 *Task blocked:* ${task.title}\n\n${responseText}`
      );
      // Detect capability gaps and trigger skill acquisition
      setImmediate(async () => {
        try {
          const gap = detectCapabilityGap(responseText);
          if (gap) {
            markSkillInProgress(task.title, gap.gap);
            console.log(`[Executor] Skill gap detected: ${gap.gap}`);
          }
        } catch { /* best effort */ }
      });
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
        pulseRecord(`deploy:${task.project || task.title}`, 'down', `verification failed: ${verified.error}`, ['broken-script']);
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

    let verification = task.verificationUrl
      ? { ok: true, evidence: `${task.verificationUrl} responded OK` }
      : null;

    if (!task.verificationUrl) {
      verification = await runTaskVerification(task, responseText, executionContext);
      if (!verification.ok) {
        const retryCount = (task.retryCount || 0) + 1;
        if (retryCount < task.retryBudget) {
          const verifierTarget = describeVerifier(task) || 'configured verifier';
          await updateTask(task.id, {
            status: TaskStatus.NEW,
            retryCount,
            lastResult: `${responseText.substring(0, 200)} - verification failed: ${verification.error}`,
            nextAction: `Previous attempt seemed to complete but ${verifierTarget} failed (${verification.error}). Try a different fix.`,
            verificationEvidence: verification.evidence || null,
          });
          await addTaskEvent(task.id, {
            type: 'retry',
            description: `Verification failed, retrying (${retryCount}/${task.retryBudget})`,
            error: verification.error,
          });
          await new Promise(r => setTimeout(r, 20000));
          const updatedTask = await getTask(task.id);
          return executeTaskAutonomously(updatedTask, sockRef);
        }

        await closeTask(task.id, TaskStatus.BLOCKED,
          `Verification failed after ${retryCount} attempts: ${verification.error}`
        );
        await updateTask(task.id, {
          verificationEvidence: verification.evidence || null,
        });
        logRegression(
          'deploy_verify',
          `Task "${task.title}": verifier failed (${verification.error}) after ${retryCount} attempts`,
          'Task exhausted retry budget without successful verification',
          `After "${task.title}" fails verification: inspect the verifier evidence before retrying`
        ).catch(() => {});
        pulseRecord(`deploy:${task.project || task.title}`, 'down', `verification failed: ${verification.error}`, ['broken-script']);
        await safeSend(sockRef, chatJid,
          `❌ *Task failed:* ${task.title}\n\nVerification failed: ${verification.error}\nEvidence: ${verification.evidence || '(none)'}\nAfter ${retryCount} attempts.`
        );
        return { status: 'failed', result: responseText };
      }

      await addTaskEvent(task.id, {
        type: 'verified',
        description: verification.evidence || 'Verifier passed',
      });
    }

    if (verification?.evidence) {
      await updateTask(task.id, {
        verificationEvidence: verification.evidence,
      });
    }

    // Done
    pulseRecord(`task:${task.kind}`, 'up', `${task.title} - completed`);
    if (task.project) pulseRecord(`deploy:${task.project}`, 'up', task.title);
    await closeTask(task.id, TaskStatus.DONE, responseText.substring(0, 400));

    // Extract fix pattern + generate postmortem (async, fire-and-forget)
    if (task.kind === 'repair' || task.kind === 'fix') {
      setImmediate(async () => {
        try {
          const extracted = await extractFixPattern(task.title, responseText);
          if (extracted) {
            await storeFixPattern({
              project: extracted.project || task.project,
              category: extracted.category,
              symptomPattern: extracted.symptom,
              rootCause: extracted.rootCause,
              fixDescription: extracted.fix,
              keywords: extracted.keywords || [],
            });
            console.log(`[Executor] Stored fix pattern from task ${task.id}`);
          }
        } catch { /* best effort */ }
        try {
          const pm = await generateAndStorePostmortem(task, responseText);
          if (pm) console.log(`[Executor] Postmortem generated for task ${task.id}: ${pm.title}`);
        } catch { /* best effort */ }
      });
    }

    // Only clear activeTaskId if we own it — don't wipe an unrelated active task
    const stateAtDone = await import('./state-store.js').then(m => m.getChatState(chatJid));
    if (stateAtDone.activeTaskId === task.id) {
      await setChatState(chatJid, {
        activeTaskId: null,
        awaitingConfirmation: false,
        lastActionTaken: `Completed: ${task.title}`,
      });
    }

    // Observer/auto-repair tasks: ALWAYS silent on success.
    // Gil only wants to hear about FAILURES after retry budget is exhausted.
    // (Failure notifications are already handled in the blocked/error paths above.)
    if (task.source === 'observer' || task.source === 'scheduler') {
      console.log(`[Executor] Silent completion (auto-repair): ${task.title}`);
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
 * Persist and surface a background execution failure so it does not disappear silently.
 */
export async function handleBackgroundTaskError(err, task, sockRef) {
  const taskId = task?.id || 'unknown';
  const chatJid = task?.chatJid || ADMIN_JID;
  const message = err?.message || String(err || 'Unknown background task error');

  console.error(`[Executor] Background task ${taskId} failed:`, message);

  if (task?.id) {
    try {
      await addTaskEvent(task.id, {
        type: 'background_error',
        description: 'Background execution failed',
        error: message,
      });
      await updateTask(task.id, {
        status: TaskStatus.BLOCKED,
        blockedReason: message,
        lastResult: message.substring(0, 400),
      });
    } catch (recordErr) {
      console.error('[Executor] Failed to persist background error:', recordErr.message);
    }
  }

  try {
    await safeSend(
      sockRef,
      chatJid,
      `❌ *Background task failed:* ${task?.title || taskId}\n\n${message}`
    );
  } catch (notifyErr) {
    console.error('[Executor] Failed to send background failure notice:', notifyErr.message);
  }
}

/**
 * Resume interrupted tasks after a container restart so long-running work is not dropped.
 */
export async function recoverCheckpoints(sockRef) {
  const tasks = await getAllTasks();
  const recoverable = tasks.filter((task) =>
    task.status === TaskStatus.IN_PROGRESS || task.status === TaskStatus.VERIFYING
  );

  if (recoverable.length === 0) {
    console.log('[Executor] No interrupted tasks to recover');
    return;
  }

  console.log(`[Executor] Recovering ${recoverable.length} interrupted task(s)`);

  for (const task of recoverable) {
    try {
      await updateTask(task.id, {
        status: TaskStatus.NEW,
        lastResult: 'Recovered after container restart; resuming execution.',
      });
      await addTaskEvent(task.id, {
        type: 'checkpoint_recovered',
        description: 'Task recovered after container restart',
      });
      const refreshedTask = await getTask(task.id);
      executeTaskAutonomously(refreshedTask || task, sockRef).catch((err) => {
        handleBackgroundTaskError(err, refreshedTask || task, sockRef);
      });
    } catch (err) {
      await handleBackgroundTaskError(err, task, sockRef);
    }
  }
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
