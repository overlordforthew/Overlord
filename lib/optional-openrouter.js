import { existsSync, readFileSync, writeFileSync } from 'fs';

const STATE_PATH = process.env.OPTIONAL_OPENROUTER_STATE_PATH || '/app/data/optional-openrouter-state.json';
const AUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function normalizePause(state) {
  const untilMs = Date.parse(state?.until || '');
  if (!untilMs || Number.isNaN(untilMs) || untilMs <= Date.now()) {
    return null;
  }
  return {
    kind: state.kind || 'provider',
    summary: state.summary || 'provider unavailable',
    until: new Date(untilMs).toISOString(),
  };
}

function formatRemaining(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (minutes >= 120) return `${Math.ceil(minutes / 60)}h`;
  return `${minutes}m`;
}

export function analyzeOptionalOpenRouterFailure({ status = null, errorText = '' } = {}) {
  const text = String(errorText || '').toLowerCase();

  if (
    status === 401
    || status === 403
    || /user not found|unauthorized|forbidden|invalid api key|authentication|invalid credentials|account disabled/.test(text)
  ) {
    return {
      kind: 'auth',
      summary: 'credentials rejected',
      cooldownMs: AUTH_COOLDOWN_MS,
    };
  }

  if (status === 429 || /rate limit|too many requests/.test(text)) {
    return {
      kind: 'rate_limit',
      summary: 'rate limited',
      cooldownMs: RATE_LIMIT_COOLDOWN_MS,
    };
  }

  if (/timed out|timeout|aborterror|aborted/.test(text)) {
    return { kind: 'timeout', summary: 'request timed out' };
  }

  if (
    (status && status >= 500)
    || /bad gateway|service unavailable|gateway timeout|temporarily unavailable|fetch failed|econnreset|econnrefused|network/.test(text)
  ) {
    return { kind: 'upstream', summary: 'upstream unavailable' };
  }

  if (status && status >= 400) {
    return { kind: 'request', summary: `http ${status}` };
  }

  return { kind: 'provider', summary: 'provider unavailable' };
}

export function getOptionalOpenRouterPause() {
  const pause = normalizePause(loadState());
  if (pause) return pause;
  const state = loadState();
  if (state?.until) saveState({});
  return null;
}

export function pauseOptionalOpenRouter(kind, summary, cooldownMs) {
  const until = new Date(Date.now() + cooldownMs).toISOString();
  const state = { kind, summary, until };
  saveState(state);
  return state;
}

export function describeOptionalOpenRouterPause(pause) {
  if (!pause?.until) return pause?.summary || 'provider unavailable';
  const remaining = Math.max(0, Date.parse(pause.until) - Date.now());
  return `${pause.summary} (${formatRemaining(remaining)} remaining)`;
}
