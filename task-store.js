/**
 * Task Store — Persistent task engine for agentic Overlord
 *
 * Tasks: data/tasks.json (atomic writes via temp+rename)
 * Events: data/task-events.jsonl (append-only log)
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

// Simple async mutex to serialize writes to tasks.json
let writeLock = Promise.resolve();
function withWriteLock(fn) {
  const next = writeLock.then(() => fn(), () => fn());
  writeLock = next.catch(() => {});
  return next;
}

const DATA_DIR = process.env.DATA_DIR || './data';
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const EVENTS_FILE = path.join(DATA_DIR, 'task-events.jsonl');

export const TaskStatus = {
  NEW: 'new',
  IN_PROGRESS: 'in_progress',
  WAITING_USER: 'waiting_for_user',
  WAITING_EXTERNAL: 'waiting_for_external',
  SCHEDULED: 'scheduled',
  BLOCKED: 'blocked',
  VERIFYING: 'verifying',
  DONE: 'done',
  ABANDONED: 'abandoned',
};

export const TaskKind = {
  REPAIR: 'repair',
  DEPLOY: 'deploy',
  INVESTIGATE: 'investigate',
  MONITOR: 'monitor',
  RESEARCH: 'research',
  OPS: 'ops',
  PERSONAL: 'personal',
  GOAL: 'goal',
  FOLLOW_UP: 'follow_up',
};

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

async function readTasks() {
  try {
    const data = await fs.readFile(TASKS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function writeTasksUnsafe(tasks) {
  ensureDir(DATA_DIR);
  const tmp = TASKS_FILE + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(tasks, null, 2));
  await fs.rename(tmp, TASKS_FILE);
}

async function writeTasks(tasks) {
  return withWriteLock(() => writeTasksUnsafe(tasks));
}

/**
 * Create a new task.
 */
export async function createTask({
  title,
  kind = TaskKind.OPS,
  chatJid,
  owner = 'Gil',
  project = null,
  status = null,
  priority = 'normal',
  riskLevel = 'low',
  executor = 'container',
  jobSpecId = null,
  dedupeKey = null,
  escalation = null,
  projectPath = null,
  repoPath = null,
  workspacePath = null,
  verifier = null,
  successCriteria = null,
  nextAction = null,
  dueAt = null,
  followUpAt = null,
  followUpCadenceMs = null,
  verificationUrl = null,
  retryBudget = 3,
  source = 'user', // 'user' | 'observer' | 'scheduler'
}) {
  const id = crypto.randomBytes(4).toString('hex');
  const task = {
    id,
    title,
    kind,
    chatJid,
    owner,
    project,
    status: status || (kind === TaskKind.GOAL ? TaskStatus.SCHEDULED : TaskStatus.NEW),
    priority,
    riskLevel,
    executor,
    jobSpecId,
    dedupeKey,
    escalation,
    createdAt: now(),
    updatedAt: now(),
    startedAt: null,
    completedAt: null,
    nextAction: nextAction || (kind === TaskKind.GOAL ? title : null),
    dueAt,
    followUpAt,
    followUpCadenceMs,
    lastFollowUpSentAt: null,
    followUpCount: 0,
    blockedReason: null,
    successCriteria,
    lastResult: null,
    retryCount: 0,
    retryBudget,
    verificationUrl,
    verifier,
    projectPath,
    repoPath,
    workspacePath,
    verificationEvidence: null,
    awaitingApproval: false,
    source,
  };
  await withWriteLock(async () => {
    const tasks = await readTasks();
    tasks.push(task);
    await writeTasksUnsafe(tasks);
  });
  await addTaskEvent(id, { type: 'created', description: `Task created: ${title}` });
  return task;
}

/**
 * Update fields on a task.
 */
export async function updateTask(taskId, updates) {
  let updated = null;
  await withWriteLock(async () => {
    const tasks = await readTasks();
    const idx = tasks.findIndex(t => t.id === taskId);
    if (idx === -1) return;
    tasks[idx] = { ...tasks[idx], ...updates, updatedAt: now() };
    updated = tasks[idx];
    await writeTasksUnsafe(tasks);
  });
  return updated;
}

export async function getTask(taskId) {
  const tasks = await readTasks();
  return tasks.find(t => t.id === taskId) || null;
}

export async function getAllTasks() {
  return await readTasks();
}

export async function getActiveTasks(chatJid = null) {
  const tasks = await readTasks();
  const active = [
    TaskStatus.NEW, TaskStatus.IN_PROGRESS, TaskStatus.WAITING_USER,
    TaskStatus.BLOCKED, TaskStatus.VERIFYING, TaskStatus.WAITING_EXTERNAL,
  ];
  return tasks.filter(t =>
    active.includes(t.status) &&
    (!chatJid || t.chatJid === chatJid)
  );
}

/**
 * Get the most recently-updated active task for a chat.
 * Used for "repair/continue/check" shorthand resolution.
 */
export async function getLastActiveTask(chatJid) {
  const tasks = await readTasks();
  const active = [
    TaskStatus.NEW, TaskStatus.IN_PROGRESS, TaskStatus.WAITING_USER,
    TaskStatus.BLOCKED, TaskStatus.VERIFYING,
  ];
  const chatTasks = tasks.filter(t => active.includes(t.status) && t.chatJid === chatJid);
  if (chatTasks.length === 0) return null;
  return chatTasks.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
}

/**
 * Get recently-completed tasks (for briefing / status checks).
 */
export async function getRecentDoneTasks(chatJid, hours = 24) {
  const tasks = await readTasks();
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
  return tasks.filter(t =>
    t.status === TaskStatus.DONE &&
    (!chatJid || t.chatJid === chatJid) &&
    (t.completedAt || '') > cutoff
  );
}

export async function getOpenGoals(chatJid = null) {
  const tasks = await readTasks();
  return tasks.filter(task =>
    task.kind === TaskKind.GOAL &&
    task.status !== TaskStatus.DONE &&
    task.status !== TaskStatus.ABANDONED &&
    (!chatJid || task.chatJid === chatJid)
  );
}

export async function getDueGoalFollowUps(limit = 20, asOf = now()) {
  const goals = await getOpenGoals();
  return goals
    .filter(goal => goal.followUpAt && goal.followUpAt <= asOf)
    .sort((a, b) => new Date(a.followUpAt) - new Date(b.followUpAt))
    .slice(0, limit);
}

export async function getNextGoalCandidates(chatJid = null, limit = 10) {
  const goals = await getOpenGoals(chatJid);
  return goals
    .sort((a, b) => {
      const aTime = Date.parse(a.dueAt || a.followUpAt || a.updatedAt || 0);
      const bTime = Date.parse(b.dueAt || b.followUpAt || b.updatedAt || 0);
      return aTime - bTime;
    })
    .slice(0, limit);
}

/**
 * Mark a task done with an optional result.
 */
export async function closeTask(taskId, status = TaskStatus.DONE, result = null) {
  return await updateTask(taskId, {
    status,
    completedAt: now(),
    lastResult: result ? String(result).substring(0, 500) : null,
  });
}

/**
 * Append an event to the task event log.
 */
export async function addTaskEvent(taskId, { type, description, result = null, error = null }) {
  ensureDir(DATA_DIR);
  const entry = JSON.stringify({
    taskId,
    type,
    description,
    result: result ? String(result).substring(0, 500) : null,
    error: error ? String(error).substring(0, 300) : null,
    at: now(),
  }) + '\n';
  await fs.appendFile(EVENTS_FILE, entry).catch(() => {});
}

/**
 * Get events for a specific task.
 */
export async function getTaskEvents(taskId, limit = 20) {
  try {
    const data = await fs.readFile(EVENTS_FILE, 'utf-8');
    const events = data.trim().split('\n')
      .filter(Boolean)
      .map(line => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean)
      .filter(e => e.taskId === taskId);
    return events.slice(-limit);
  } catch {
    return [];
  }
}

/**
 * Infer task kind from message text.
 */
export function inferTaskKind(text) {
  if (!text) return TaskKind.OPS;
  if (/goal|follow up|follow-up|keep track|keep me posted/i.test(text)) return TaskKind.GOAL;
  if (/deploy|push|build|rebuild|ship/i.test(text)) return TaskKind.DEPLOY;
  if (/fix|repair|error|broken|failed|crash|down|issue/i.test(text)) return TaskKind.REPAIR;
  if (/check|monitor|watch|health|diagnose|investigate/i.test(text)) return TaskKind.INVESTIGATE;
  if (/research|explain|analyze|compare|summarize/i.test(text)) return TaskKind.RESEARCH;
  return TaskKind.OPS;
}

// ---- Formatting helpers ----

const STATUS_EMOJI = {
  new: '🆕', in_progress: '⚙️', waiting_for_user: '⏳',
  waiting_for_external: '🔄', scheduled: '📅', blocked: '🚫',
  verifying: '🔍', done: '✅', abandoned: '❌',
};

function formatTimeLabel(timestamp) {
  if (!timestamp) return null;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return timestamp;
  return parsed.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDurationLabel(ms) {
  if (!ms) return null;
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(ms / 3600000);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(ms / 86400000)}d`;
}

export function formatTaskSummary(task) {
  const age = task.createdAt
    ? Math.round((Date.now() - new Date(task.createdAt)) / 60000)
    : 0;
  const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
  const emoji = STATUS_EMOJI[task.status] || '•';
  const result = task.lastResult ? `\n   → ${task.lastResult.substring(0, 100)}` : '';
  const goalBits = [];
  if (task.kind === TaskKind.GOAL) {
    if (task.dueAt) goalBits.push(`due ${formatTimeLabel(task.dueAt)}`);
    if (task.followUpAt) goalBits.push(`follow ${formatTimeLabel(task.followUpAt)}`);
  }
  const goalMeta = goalBits.length > 0 ? ` | ${goalBits.join(' | ')}` : '';
  return `${emoji} [${task.id}] ${task.title} (${ageStr})${goalMeta}${result}`;
}

export function formatTaskList(tasks) {
  if (tasks.length === 0) return 'No active tasks.';
  return tasks.map(formatTaskSummary).join('\n');
}

export function formatTaskDetail(task, events = []) {
  const lines = [
    `*Task: ${task.title}*`,
    `ID: ${task.id} | Kind: ${task.kind} | Priority: ${task.priority}`,
    `Status: ${STATUS_EMOJI[task.status] || ''} ${task.status}`,
    `Created: ${task.createdAt?.substring(0, 16)} | Source: ${task.source}`,
  ];
  if (task.project) lines.push(`Project: ${task.project}`);
  if (task.executor) lines.push(`Executor: ${task.executor} | Risk: ${task.riskLevel}`);
  if (task.dueAt) lines.push(`Due: ${formatTimeLabel(task.dueAt)}`);
  if (task.followUpAt) lines.push(`Next follow-up: ${formatTimeLabel(task.followUpAt)}`);
  if (task.followUpCadenceMs) lines.push(`Follow cadence: every ${formatDurationLabel(task.followUpCadenceMs)}`);
  if (task.followUpCount > 0) lines.push(`Follow-ups sent: ${task.followUpCount}`);
  if (task.successCriteria) lines.push(`Success: ${task.successCriteria}`);
  if (task.workspacePath) lines.push(`Workspace: ${task.workspacePath}`);
  if (task.blockedReason) lines.push(`Blocked: ${task.blockedReason}`);
  if (task.verificationEvidence) lines.push(`Verification: ${task.verificationEvidence.substring(0, 200)}`);
  if (task.lastResult) lines.push(`Last result: ${task.lastResult.substring(0, 200)}`);
  if (task.retryCount > 0) lines.push(`Retries: ${task.retryCount}/${task.retryBudget}`);
  if (events.length > 0) {
    lines.push('\nEvents:');
    events.slice(-5).forEach(e => lines.push(`  [${e.at?.substring(11, 16)}] ${e.type}: ${e.description}`));
  }
  return lines.join('\n');
}

export function formatGoalList(goals) {
  if (!goals || goals.length === 0) return 'No open goals.';
  return goals.map(formatTaskSummary).join('\n');
}
