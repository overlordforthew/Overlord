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

export function createObserverGuard({ dataDir = './data' } = {}) {
  const stateFile = path.join(dataDir, 'observer-signals.json');

  async function trackSignal({
    key,
    minHits = 2,
    windowMs = 15 * 60 * 1000,
    cooldownMs = 30 * 60 * 1000,
    corroborated = false,
    meta = null,
  }) {
    const state = await readJSON(stateFile, { signals: {} });
    const signal = state.signals[key] || {
      hits: [],
      lastSeenAt: null,
      lastEscalatedAt: null,
      meta: null,
    };

    const now = Date.now();
    signal.hits = signal.hits.filter((ts) => (now - ts) <= windowMs);
    signal.hits.push(now);
    signal.lastSeenAt = new Date(now).toISOString();
    signal.meta = meta;

    const threshold = corroborated ? 1 : minHits;
    const lastEscalatedAt = signal.lastEscalatedAt ? Date.parse(signal.lastEscalatedAt) : 0;
    const inCooldown = lastEscalatedAt && (now - lastEscalatedAt) < cooldownMs;
    const shouldEscalate = !inCooldown && signal.hits.length >= threshold;

    if (shouldEscalate) {
      signal.lastEscalatedAt = new Date(now).toISOString();
      signal.hits = [];
    }

    state.signals[key] = signal;
    await writeJSON(stateFile, state);

    return {
      shouldEscalate,
      hitCount: signal.hits.length || (shouldEscalate ? threshold : 0),
      lastSeenAt: signal.lastSeenAt,
      lastEscalatedAt: signal.lastEscalatedAt,
      meta: signal.meta,
    };
  }

  return {
    trackSignal,
  };
}
