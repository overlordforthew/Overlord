import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

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

function defaultState() {
  return { incidents: {} };
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(Number(ms || 0) / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function pruneState(state, nowMs = Date.now()) {
  const cutoffMs = nowMs - (7 * 24 * 60 * 60 * 1000);
  for (const [key, incident] of Object.entries(state.incidents || {})) {
    const lastTouchedAt = Date.parse(
      incident.lastRecoveredAt ||
      incident.lastSeenAt ||
      incident.lastOpenedAt ||
      incident.startedAt ||
      0
    );
    if (!incident.isOpen && lastTouchedAt && lastTouchedAt < cutoffMs) {
      delete state.incidents[key];
    }
  }
}

export async function getIncidentStatusSummary(dataDir = './data', windowHours = 24) {
  const stateFile = path.join(dataDir, 'service-incidents.json');
  const state = await readJSON(stateFile, defaultState());
  const nowMs = Date.now();
  const windowMs = Math.max(1, Number(windowHours) || 24) * 60 * 60 * 1000;
  const incidents = Object.values(state.incidents || {});

  const open = incidents
    .filter((incident) => incident.isOpen)
    .sort((a, b) => Date.parse(a.startedAt || a.lastSeenAt || 0) - Date.parse(b.startedAt || b.lastSeenAt || 0));

  const recovered = incidents
    .filter((incident) => {
      const recoveredAtMs = Date.parse(incident.lastRecoveredAt || 0);
      return recoveredAtMs && (nowMs - recoveredAtMs) <= windowMs;
    })
    .sort((a, b) => Date.parse(b.lastRecoveredAt || 0) - Date.parse(a.lastRecoveredAt || 0));

  return { open, recovered };
}

export function createIncidentTracker({ dataDir = './data' } = {}) {
  const stateFile = path.join(dataDir, 'service-incidents.json');

  async function mutate(mutator) {
    const state = await readJSON(stateFile, defaultState());
    const result = await mutator(state);
    pruneState(state);
    await writeJSON(stateFile, state);
    return result;
  }

  async function recordObservation(meta = {}) {
    const nowIso = new Date().toISOString();
    return mutate((state) => {
      const incident = state.incidents[meta.key] || {
        key: meta.key,
        service: meta.service || 'unknown',
        family: meta.family || 'unknown',
        degradedTitle: meta.degradedTitle || meta.service || 'Service issue',
        degradedDetail: meta.degradedDetail || '',
        recoveredTitle: meta.recoveredTitle || meta.degradedTitle || meta.service || 'Service issue',
        recoveredDetail: meta.recoveredDetail || '',
        recoveryWindowMs: meta.recoveryWindowMs || (15 * 60 * 1000),
        isOpen: false,
        firstSeenAt: nowIso,
        startedAt: null,
        lastSeenAt: null,
        lastOpenedAt: null,
        lastRecoveredAt: null,
        lastDurationMs: null,
        openCount: 0,
      };

      if (!incident.isOpen && !incident.firstSeenAt) {
        incident.firstSeenAt = nowIso;
      }

      incident.service = meta.service || incident.service;
      incident.family = meta.family || incident.family;
      incident.degradedTitle = meta.degradedTitle || incident.degradedTitle;
      incident.degradedDetail = meta.degradedDetail || incident.degradedDetail;
      incident.recoveredTitle = meta.recoveredTitle || incident.recoveredTitle;
      incident.recoveredDetail = meta.recoveredDetail || incident.recoveredDetail;
      incident.recoveryWindowMs = meta.recoveryWindowMs || incident.recoveryWindowMs || (15 * 60 * 1000);
      incident.lastSeenAt = nowIso;

      state.incidents[meta.key] = incident;
      return incident;
    });
  }

  async function openIncident(meta = {}) {
    const nowIso = new Date().toISOString();
    return mutate((state) => {
      const incident = state.incidents[meta.key] || {
        key: meta.key,
        isOpen: false,
      };

      if (!incident.firstSeenAt) incident.firstSeenAt = nowIso;
      incident.service = meta.service || incident.service || 'unknown';
      incident.family = meta.family || incident.family || 'unknown';
      incident.degradedTitle = meta.degradedTitle || incident.degradedTitle || incident.service;
      incident.degradedDetail = meta.degradedDetail || incident.degradedDetail || '';
      incident.recoveredTitle = meta.recoveredTitle || incident.recoveredTitle || incident.degradedTitle;
      incident.recoveredDetail = meta.recoveredDetail || incident.recoveredDetail || '';
      incident.recoveryWindowMs = meta.recoveryWindowMs || incident.recoveryWindowMs || (15 * 60 * 1000);
      incident.lastSeenAt = nowIso;

      if (incident.isOpen) {
        state.incidents[meta.key] = incident;
        return { opened: false, incident };
      }

      incident.isOpen = true;
      incident.startedAt = incident.firstSeenAt || nowIso;
      incident.lastOpenedAt = nowIso;
      incident.lastRecoveredAt = null;
      incident.lastDurationMs = null;
      incident.openCount = (incident.openCount || 0) + 1;

      state.incidents[meta.key] = incident;
      return { opened: true, incident };
    });
  }

  async function recoverQuietIncidents() {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();

    return mutate((state) => {
      const recovered = [];
      for (const incident of Object.values(state.incidents || {})) {
        if (!incident.isOpen) continue;

        const lastSeenAtMs = Date.parse(incident.lastSeenAt || 0);
        const recoveryWindowMs = Number(incident.recoveryWindowMs || 15 * 60 * 1000);
        if (!lastSeenAtMs || (nowMs - lastSeenAtMs) < recoveryWindowMs) continue;

        const startedAtMs = Date.parse(incident.startedAt || incident.firstSeenAt || incident.lastOpenedAt || incident.lastSeenAt || nowIso);
        incident.isOpen = false;
        incident.lastRecoveredAt = nowIso;
        incident.lastDurationMs = Math.max(0, nowMs - startedAtMs);
        incident.firstSeenAt = null;
        incident.startedAt = null;
        recovered.push({ ...incident });
      }

      return recovered;
    });
  }

  return {
    recordObservation,
    openIncident,
    recoverQuietIncidents,
  };
}
