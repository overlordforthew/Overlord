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

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJSON(file, data) {
  ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function truncate(text, max = 500) {
  if (text == null) return null;
  return String(text).replace(/\s+/g, ' ').trim().slice(0, max);
}

function errorFingerprint(text) {
  return crypto.createHash('sha1').update(String(text || '')).digest('hex');
}

function defaultState() {
  return { jobs: {} };
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
  const stateFile = path.join(dataDir, 'job-state.json');
  const runsFile = path.join(dataDir, 'job-runs.jsonl');

  async function appendRun(entry) {
    ensureDir(path.dirname(runsFile));
    await fs.appendFile(runsFile, JSON.stringify(entry) + '\n', 'utf8');
  }

  async function updateState(jobId, recipe) {
    const state = await readJSON(stateFile, defaultState());
    state.jobs[jobId] = {
      ...(state.jobs[jobId] || {}),
      ...recipe,
    };
    await writeJSON(stateFile, state);
    return state.jobs[jobId];
  }

  async function getState(jobId) {
    const state = await readJSON(stateFile, defaultState());
    return state.jobs[jobId] || null;
  }

  async function sendFailureAlert(spec, message, fingerprint, previousState) {
    const cooldownMs = spec.failureAlertCooldownMs ?? 6 * 60 * 60 * 1000;
    const lastAlertAt = previousState?.lastFailureAlertAt ? Date.parse(previousState.lastFailureAlertAt) : 0;
    const sameFailure = previousState?.lastFailureAlertFingerprint === fingerprint;
    const inCooldown = sameFailure && lastAlertAt && (Date.now() - lastAlertAt) < cooldownMs;
    if (inCooldown || !sendAdminText) return false;
    await sendAdminText(message, adminJid);
    return true;
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
      const reportText = truncate(result.report || result.message || message, 5000);
      const shouldSendSuccess =
        spec.delivery === JobDelivery.WHATSAPP_FIRST &&
        !result.suppressSuccessAlert &&
        Boolean(message);

      if (shouldSendSuccess && sendAdminText) {
        await sendAdminText(message, adminJid);
      } else if (spec.delivery === JobDelivery.HYBRID && result.forceWhatsApp && sendAdminText) {
        await sendAdminText(message, adminJid);
      }

      if (reportText && writeReport && result.writeReport !== false) {
        writeReport(spec.reportType || spec.id, reportText);
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
      });

      return {
        ok: true,
        message,
        state,
      };
    } catch (err) {
      const message = formatFailureMessage(spec, err, previousState);
      const fingerprint = errorFingerprint(message);
      const sentAlert = await sendFailureAlert(spec, message, fingerprint, previousState);

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
      });

      return {
        ok: false,
        error: err,
        state,
        alertSent: sentAlert,
      };
    }
  }

  return {
    runJob,
    getState,
    updateState,
  };
}
