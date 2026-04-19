import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';

export const JobExecutor = Object.freeze({
  CONTAINER: 'container',
  HOST_BROWSER: 'host-browser',
  REMOTE_SSH: 'remote-ssh',
  REPO_WORKER: 'repo-worker',
});

export const JobDelivery = Object.freeze({
  WHATSAPP_FIRST: 'whatsapp_first',
  HYBRID: 'hybrid',
  REPORT_ONLY: 'report_only',
});

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJSON(file, data) {
  ensureDir(path.dirname(file));
  const tempFile = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
  await fs.rename(tempFile, file);
}

function truncate(text, max = 500) {
  if (text == null) return null;
  return String(text).replace(/\s+/g, ' ').trim().slice(0, max);
}

function truncateReport(text, max = 5000) {
  if (text == null) return null;
  return String(text).trim().slice(0, max);
}

function errorFingerprint(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}

function defaultState() {
  return { jobs: {} };
}

function defaultDeliveryQueue() {
  return { items: [] };
}

const DELIVERY_QUEUE_FILENAME = 'delivery-queue.json';
const DELIVERY_RETRY_DELAYS_MS = [
  60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
];
const DELIVERY_RETENTION_MS = 24 * 60 * 60 * 1000;
const DELIVERY_LEASE_MS = 10 * 60 * 1000;

function getStateFile(dataDir) {
  return path.join(dataDir, 'job-state.json');
}

function getDeliveryQueueFile(dataDir) {
  return path.join(dataDir, DELIVERY_QUEUE_FILENAME);
}

function nextDeliveryRetryDelayMs(attempts = 0) {
  return DELIVERY_RETRY_DELAYS_MS[Math.min(Math.max(0, attempts), DELIVERY_RETRY_DELAYS_MS.length - 1)];
}

function cleanDeliveryQueueItems(items = [], nowMs = Date.now()) {
  return items
    .map((item) => ({ ...item }))
    .filter((item) => {
      const expiresAt = Date.parse(item.expiresAt || '');
      if (expiresAt && expiresAt <= nowMs) return false;

      const processingAt = Date.parse(item.processingAt || '');
      if (processingAt && (nowMs - processingAt) > DELIVERY_LEASE_MS) {
        delete item.processingAt;
        delete item.processingClaim;
      }
      return true;
    });
}

export async function loadDeliveryQueue(dataDir = './data') {
  const queue = await readJSON(getDeliveryQueueFile(dataDir), defaultDeliveryQueue());
  return cleanDeliveryQueueItems(queue.items || []);
}

export async function enqueueDelivery({
  dataDir = './data',
  jid,
  text,
  jobId = null,
  runId = null,
  label = null,
  category = 'admin-text',
  dedupeKey = null,
  initialError = null,
  retentionMs = DELIVERY_RETENTION_MS,
} = {}) {
  if (!jid || !text) return { queued: false, duplicate: false, item: null };

  const queueFile = getDeliveryQueueFile(dataDir);
  const queueLock = `${queueFile}.lock`;
  const fingerprint = dedupeKey || errorFingerprint(`${category}:${jid}:${text}`);

  return withFileLock(queueLock, async () => {
    const queue = await readJSON(queueFile, defaultDeliveryQueue());
    queue.items = cleanDeliveryQueueItems(queue.items || []);

    const existing = queue.items.find((item) => item.dedupeKey === fingerprint);
    if (existing) {
      return { queued: false, duplicate: true, item: existing };
    }

    const item = {
      id: crypto.randomUUID(),
      jid,
      text: String(text),
      jobId,
      runId,
      label,
      category,
      dedupeKey: fingerprint,
      attempts: 0,
      createdAt: new Date().toISOString(),
      nextAttemptAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + retentionMs).toISOString(),
      lastError: initialError ? truncate(initialError, 280) : null,
      processingAt: null,
      processingClaim: null,
    };

    queue.items.push(item);
    await writeJSON(queueFile, queue);
    return { queued: true, duplicate: false, item };
  });
}

async function clearRecoveredDeliveryIssues(dataDir, deliveredItems = []) {
  const relevant = deliveredItems.filter((item) => item?.jobId && item?.runId);
  if (relevant.length === 0) return;

  const stateFile = getStateFile(dataDir);
  const stateLock = `${stateFile}.lock`;
  const recoveredAt = new Date().toISOString();

  await withFileLock(stateLock, async () => {
    const state = await readJSON(stateFile, defaultState());
    let changed = false;

    for (const item of relevant) {
      const job = state.jobs?.[item.jobId];
      if (!job) continue;
      if (job.lastDeliveryIssueRunId && job.lastDeliveryIssueRunId !== item.runId) continue;

      state.jobs[item.jobId] = {
        ...job,
        lastDeliveryIssue: null,
        lastDeliveryIssueAt: null,
        lastDeliveryIssueRunId: null,
        lastDeliveryPending: false,
        lastDeliveryQueuedAt: null,
        lastDeliveryQueuedId: null,
        lastDeliveryRecoveredAt: recoveredAt,
        lastDeliveredAt: recoveredAt,
      };
      changed = true;
    }

    if (changed) {
      await writeJSON(stateFile, state);
    }
  });
}

export async function drainDeliveryQueue({
  dataDir = './data',
  sendAdminText,
  limit = 3,
} = {}) {
  if (!sendAdminText) {
    return {
      claimed: 0,
      sent: 0,
      failed: 0,
      dropped: 0,
      remaining: (await loadDeliveryQueue(dataDir)).length,
    };
  }

  const queueFile = getDeliveryQueueFile(dataDir);
  const queueLock = `${queueFile}.lock`;
  const claimId = crypto.randomUUID();
  const nowMs = Date.now();

  const claimed = await withFileLock(queueLock, async () => {
    const queue = await readJSON(queueFile, defaultDeliveryQueue());
    queue.items = cleanDeliveryQueueItems(queue.items || [], nowMs);

    const due = queue.items
      .filter((item) => !item.processingClaim)
      .filter((item) => Date.parse(item.nextAttemptAt || item.createdAt || 0) <= nowMs)
      .slice(0, limit);

    for (const item of due) {
      item.processingClaim = claimId;
      item.processingAt = new Date(nowMs).toISOString();
    }

    await writeJSON(queueFile, queue);
    return due.map((item) => ({ ...item }));
  });

  if (claimed.length === 0) {
    return {
      claimed: 0,
      sent: 0,
      failed: 0,
      dropped: 0,
      remaining: (await loadDeliveryQueue(dataDir)).length,
    };
  }

  const results = [];
  for (const item of claimed) {
    try {
      await sendAdminText(item.text, item.jid);
      results.push({ item, ok: true });
    } catch (err) {
      results.push({
        item,
        ok: false,
        error: truncate(err?.message || err, 280),
      });
    }
  }

  let remaining = 0;
  let dropped = 0;
  await withFileLock(queueLock, async () => {
    const queue = await readJSON(queueFile, defaultDeliveryQueue());
    queue.items = cleanDeliveryQueueItems(queue.items || []);
    const resultById = new Map(results.map((result) => [result.item.id, result]));

    queue.items = queue.items.flatMap((item) => {
      if (item.processingClaim !== claimId) return [item];
      const result = resultById.get(item.id);
      if (!result) return [item];
      if (result.ok) return [];

      const attempts = Number(item.attempts || 0) + 1;
      const nextAttemptAt = new Date(Date.now() + nextDeliveryRetryDelayMs(attempts - 1)).toISOString();
      const expiresAtMs = Date.parse(item.expiresAt || '');
      if (expiresAtMs && expiresAtMs <= Date.now()) {
        dropped += 1;
        return [];
      }
      return [{
        ...item,
        attempts,
        nextAttemptAt,
        lastError: result.error,
        processingAt: null,
        processingClaim: null,
      }];
    });

    remaining = queue.items.length;
    await writeJSON(queueFile, queue);
  });

  const deliveredItems = results.filter((result) => result.ok).map((result) => result.item);
  await clearRecoveredDeliveryIssues(dataDir, deliveredItems);

  return {
    claimed: claimed.length,
    sent: deliveredItems.length,
    failed: results.filter((result) => !result.ok).length,
    dropped,
    remaining,
  };
}

async function withFileLock(lockPath, fn, {
  timeoutMs = 10000,
  staleMs = 30000,
  retryMs = 50,
} = {}) {
  const start = Date.now();

  while (true) {
    try {
      await fs.mkdir(lockPath);
      break;
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;

      try {
        const stats = await fs.stat(lockPath);
        if ((Date.now() - stats.mtimeMs) > staleMs) {
          await fs.rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statErr) {
        if (statErr?.code === 'ENOENT') continue;
        throw statErr;
      }

      if ((Date.now() - start) > timeoutMs) {
        throw new Error(`Timed out waiting for lock: ${lockPath}`);
      }

      await sleep(retryMs);
    }
  }

  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
  }
}

export async function loadJobState(dataDir = './data') {
  return readJSON(path.join(dataDir, 'job-state.json'), defaultState());
}

export async function loadRecentJobRuns(dataDir = './data', limit = 50) {
  const file = path.join(dataDir, 'job-runs.jsonl');
  try {
    const raw = await fs.readFile(file, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

function formatSuccessMessage(spec, result, verification) {
  if (result.message) return String(result.message).trim();
  if (result.summary) return String(result.summary).trim();
  const lines = [
    `✅ ${spec.label}`,
    `Executor: ${spec.executor}`,
  ];
  if (verification?.evidence) lines.push(`Verification: ${truncate(verification.evidence, 220)}`);
  if (spec.trigger) lines.push(`Trigger: ${spec.trigger}`);
  return lines.join('\n');
}

function formatFailureMessage(spec, err, previousState) {
  const lines = [
    `❌ ${spec.label} failed`,
    `Executor: ${spec.executor}`,
  ];
  if (previousState?.lastSuccessAt) {
    lines.push(`Last success: ${previousState.lastSuccessAt}`);
  }
  lines.push(`Error: ${truncate(err?.message || err, 300)}`);
  if (spec.trigger) lines.push(`Next retry: scheduled by ${spec.trigger}`);
  if (spec.trigger) lines.push(`Trigger: ${spec.trigger}`);
  if (spec.escalation) lines.push(`Escalation: ${spec.escalation}`);
  return lines.join('\n');
}

export function createJobRuntime({
  dataDir = './data',
  adminJid,
  sendAdminText,
  writeReport,
}) {
  const stateFile = getStateFile(dataDir);
  const stateLock = `${stateFile}.lock`;
  const runsFile = path.join(dataDir, 'job-runs.jsonl');

  async function appendRun(entry) {
    ensureDir(path.dirname(runsFile));
    await fs.appendFile(runsFile, JSON.stringify(entry) + '\n', 'utf8');
  }

  async function updateState(jobId, recipe) {
    return withFileLock(stateLock, async () => {
      const state = await readJSON(stateFile, defaultState());
      state.jobs = state.jobs || {};
      state.jobs[jobId] = {
        ...(state.jobs[jobId] || {}),
        ...recipe,
      };
      await writeJSON(stateFile, state);
      return state.jobs[jobId];
    });
  }

  async function getState(jobId) {
    const state = await readJSON(stateFile, defaultState());
    return state.jobs[jobId] || null;
  }

  async function deliverAdminMessage({
    message,
    jid = adminJid,
    jobId = null,
    runId = null,
    label = null,
    category = 'job-message',
    dedupeKey = null,
  } = {}) {
    if (!message || !jid || !sendAdminText) {
      return { sent: false, queued: false, deliveryError: 'delivery unavailable', queueId: null };
    }

    try {
      await sendAdminText(message, jid);
      return { sent: true, queued: false, deliveryError: null, queueId: null };
    } catch (err) {
      const deliveryError = truncate(err?.message || err, 280);
      const queued = await enqueueDelivery({
        dataDir,
        jid,
        text: message,
        jobId,
        runId,
        label,
        category,
        dedupeKey,
        initialError: deliveryError,
      }).catch(() => null);

      return {
        sent: false,
        queued: Boolean(queued?.queued || queued?.duplicate),
        deliveryError,
        queueId: queued?.item?.id || null,
      };
    }
  }

  async function sendFailureAlert(spec, message, fingerprint, previousState, runId) {
    const cooldownMs = spec.failureAlertCooldownMs ?? 6 * 60 * 60 * 1000;
    const lastAlertAt = previousState?.lastFailureAlertAt ? Date.parse(previousState.lastFailureAlertAt) : 0;
    const sameFailure = previousState?.lastFailureAlertFingerprint === fingerprint;
    const inCooldown = sameFailure && lastAlertAt && (Date.now() - lastAlertAt) < cooldownMs;
    if (inCooldown) return { sent: false, queued: false, deliveryError: null };
    return deliverAdminMessage({
      message,
      jid: adminJid,
      jobId: spec.id,
      runId,
      label: spec.label,
      category: 'failure-alert',
      dedupeKey: `failure-alert:${spec.id}:${fingerprint}`,
    });
  }

  async function runJob(spec, handler) {
    const startedAt = new Date().toISOString();
    const runId = crypto.randomUUID();
    const previousState = await getState(spec.id);

    await appendRun({
      runId,
      jobId: spec.id,
      label: spec.label,
      status: 'started',
      startedAt,
      trigger: spec.trigger || null,
      executor: spec.executor,
      delivery: spec.delivery,
      dedupeKey: spec.dedupeKey || spec.id,
      escalation: spec.escalation || null,
    });

    try {
      const result = await handler({
        runId,
        previousState,
        spec,
      }) || {};

      if (result.skip) {
        const state = await updateState(spec.id, {
          id: spec.id,
          label: spec.label,
          trigger: spec.trigger || null,
          executor: spec.executor,
          delivery: spec.delivery,
          freshnessSlaMinutes: spec.freshnessSlaMinutes ?? null,
          escalation: spec.escalation || null,
          dedupeKey: spec.dedupeKey || spec.id,
          lastRunAt: startedAt,
          lastRunStatus: 'skipped',
          lastSkipReason: truncate(result.reason || 'Skipped', 220),
        });
        await appendRun({
          runId,
          jobId: spec.id,
          label: spec.label,
          status: 'skipped',
          startedAt,
          finishedAt: new Date().toISOString(),
          reason: truncate(result.reason || 'Skipped', 220),
          executor: spec.executor,
          delivery: spec.delivery,
        });
        return { ok: true, skipped: true, state };
      }

      const verify = result.verify || spec.verify;
      let verification = { ok: true, evidence: null };
      if (typeof verify === 'function') {
        verification = await verify(result, { runId, previousState, spec });
      }
      if (!verification?.ok) {
        throw new Error(verification.error || 'Verification failed');
      }

      const message = formatSuccessMessage(spec, result, verification);
      const reportText = truncateReport(result.report || result.message || message, 5000);
      const shouldSendSuccess =
        spec.delivery === JobDelivery.WHATSAPP_FIRST &&
        !result.suppressSuccessAlert &&
        Boolean(message);

      if (reportText && writeReport && result.writeReport !== false) {
        writeReport(spec.reportType || spec.id, reportText);
      }

      let deliveryError = null;
      let deliveryQueued = false;
      let queueId = null;
      const allowDeliveryFailure = Boolean(result.allowDeliveryFailure ?? spec.allowDeliveryFailure);
      const shouldSendHybrid = spec.delivery === JobDelivery.HYBRID && result.forceWhatsApp;
      if ((shouldSendSuccess || shouldSendHybrid) && sendAdminText) {
        const deliveryResult = await deliverAdminMessage({
          message,
          jid: adminJid,
          jobId: spec.id,
          runId,
          label: spec.label,
          category: shouldSendHybrid ? 'hybrid-success' : 'success-message',
          dedupeKey: `${spec.id}:${runId}:success`,
        });
        deliveryError = deliveryResult.deliveryError;
        deliveryQueued = deliveryResult.queued;
        queueId = deliveryResult.queueId;
        if (deliveryError && !allowDeliveryFailure && !deliveryQueued) {
          throw new Error(deliveryError);
        }
      }

      const state = await updateState(spec.id, {
        id: spec.id,
        label: spec.label,
        trigger: spec.trigger || null,
        executor: spec.executor,
        delivery: spec.delivery,
        freshnessSlaMinutes: spec.freshnessSlaMinutes ?? null,
        escalation: spec.escalation || null,
        dedupeKey: spec.dedupeKey || spec.id,
        lastRunAt: startedAt,
        lastRunStatus: 'ok',
        lastSuccessAt: new Date().toISOString(),
        lastSuccessPreview: truncate(message, 240),
        lastVerificationEvidence: truncate(verification?.evidence, 300),
        lastFailure: null,
        lastDeliveryIssueAt: deliveryError ? new Date().toISOString() : null,
        lastDeliveryIssue: deliveryError,
        lastDeliveryIssueRunId: deliveryError ? runId : null,
        lastDeliveryPending: deliveryQueued,
        lastDeliveryQueuedAt: deliveryQueued ? new Date().toISOString() : null,
        lastDeliveryQueuedId: queueId,
        lastDeliveryRecoveredAt: deliveryError ? (previousState?.lastDeliveryRecoveredAt || null) : new Date().toISOString(),
        lastDeliveredAt: deliveryError ? (previousState?.lastDeliveredAt || null) : new Date().toISOString(),
      });

      await appendRun({
        runId,
        jobId: spec.id,
        label: spec.label,
        status: 'ok',
        startedAt,
        finishedAt: new Date().toISOString(),
        executor: spec.executor,
        delivery: spec.delivery,
        reportType: spec.reportType || spec.id,
        verificationEvidence: truncate(verification?.evidence, 300),
        summary: truncate(message, 300),
        deliveryError,
        deliveryQueued,
      });

      return {
        ok: true,
        message,
        state,
        deliveryError,
        deliveryQueued,
      };
    } catch (err) {
      const message = formatFailureMessage(spec, err, previousState);
      const fingerprint = errorFingerprint(message);
      const alertDelivery = await sendFailureAlert(spec, message, fingerprint, previousState, runId);
      const sentAlert = alertDelivery.sent;

      if (writeReport) {
        writeReport(`${spec.reportType || spec.id}-failure`, message);
      }

      const state = await updateState(spec.id, {
        id: spec.id,
        label: spec.label,
        trigger: spec.trigger || null,
        executor: spec.executor,
        delivery: spec.delivery,
        freshnessSlaMinutes: spec.freshnessSlaMinutes ?? null,
        escalation: spec.escalation || null,
        dedupeKey: spec.dedupeKey || spec.id,
        lastRunAt: startedAt,
        lastRunStatus: 'failed',
        lastFailureAt: new Date().toISOString(),
        lastFailure: truncate(err?.message || err, 280),
        lastFailureAlertAt: sentAlert ? new Date().toISOString() : (previousState?.lastFailureAlertAt || null),
        lastFailureAlertFingerprint: sentAlert ? fingerprint : (previousState?.lastFailureAlertFingerprint || null),
        lastFailureAlertQueuedAt: alertDelivery.queued ? new Date().toISOString() : (previousState?.lastFailureAlertQueuedAt || null),
      });

      await appendRun({
        runId,
        jobId: spec.id,
        label: spec.label,
        status: 'failed',
        startedAt,
        finishedAt: new Date().toISOString(),
        executor: spec.executor,
        delivery: spec.delivery,
        error: truncate(err?.stack || err?.message || err, 600),
        alertSent: sentAlert,
        alertQueued: alertDelivery.queued,
        alertDeliveryError: alertDelivery.deliveryError,
      });

      return {
        ok: false,
        error: err,
        state,
        alertSent: sentAlert,
        alertQueued: alertDelivery.queued,
      };
    }
  }

  return {
    runJob,
    getState,
    updateState,
  };
}
