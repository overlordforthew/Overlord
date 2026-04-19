/**
 * Shared WhatsApp-facing copy helpers.
 *
 * Keep user-visible failure text short, calm, and informative without dumping
 * raw internal errors into chat.
 */

export function buildModelFooter({ usedModelId, requestedModelId }) {
  if (!usedModelId || usedModelId === 'unknown') return '';
  const lines = [`Used: ${usedModelId}`];
  if (requestedModelId && requestedModelId !== 'unknown' && requestedModelId !== usedModelId) {
    lines.push(`Requested: ${requestedModelId}`);
  }
  return `\n\n${lines.join('\n')}`;
}

export function hasModelFooter(text = '') {
  return /(?:^|\n)Used:\s+\S+/m.test(text) || /(?:^|\n)Requested:\s+\S+/m.test(text);
}

export function isDirectTimeQuery(text = '') {
  const normalized = text.trim().toLowerCase().replace(/[?!.\s]+$/g, '');
  return /^(now,\s*)?(what time is it(?: now)?|what's the time(?: now)?|whats the time(?: now)?|current time|time)$/.test(normalized);
}

export function buildTimeReply(now = new Date()) {
  const utcTime = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  });
  const localTime = now.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Caracas',
  });
  return `Current time: ${utcTime} UTC (${localTime} UTC-4).\n\nUsed: system-clock`;
}

export function cleanWhatsAppErrorDetail(detail = '') {
  if (!detail) return '';
  let text = String(detail).replace(/\s+/g, ' ').trim();
  text = text.replace(/^Error:\s*/i, '');

  if (/ENOENT|command not found|not recognized as the name|No such file/i.test(text)) {
    return 'A required tool was not available.';
  }
  if (/timed out|timeout/i.test(text)) {
    return 'The request timed out.';
  }
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up|network error/i.test(text)) {
    return 'The upstream service was unavailable.';
  }
  if (/\b401\b|\b403\b|unauthorized|forbidden|access denied/i.test(text)) {
    return 'Access was denied by the upstream service.';
  }
  if (/out of memory|oom|sigkill|memory/i.test(text)) {
    return 'The server was under heavy load.';
  }
  if (/json/i.test(text) && text.length > 120) {
    return 'An upstream service returned malformed data.';
  }

  text = text.replace(/["`]/g, '');
  text = text.replace(/\b(code|status)\s*[=:]?\s*\d+\b/ig, '').replace(/\s{2,}/g, ' ').trim();
  if (text.length > 140) text = `${text.slice(0, 137)}...`;
  if (!text) return '';
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

export function formatWhatsAppError(summary, detail = '', {
  icon = '⚠️',
  fallback = 'Please try again in a moment.',
} = {}) {
  const cleanDetail = cleanWhatsAppErrorDetail(detail);
  if (cleanDetail) return `${icon} ${summary} ${cleanDetail}`.trim();
  return `${icon} ${summary} ${fallback}`.trim();
}

export function formatTaskFailureNotice({
  title,
  detail = '',
  attempts = null,
  verificationTarget = '',
  evidence = '',
} = {}) {
  const lines = [`❌ Task failed: ${title || 'Unnamed task'}`];
  if (verificationTarget) lines.push(`Check: ${verificationTarget}`);
  const cleanDetail = cleanWhatsAppErrorDetail(detail);
  if (cleanDetail) lines.push(cleanDetail);
  if (evidence) lines.push(`Evidence: ${evidence}`);
  if (Number.isFinite(attempts) && attempts > 1) lines.push(`Attempts: ${attempts}`);
  return lines.join('\n\n');
}

export function formatTaskBlockedNotice(title, detail = '') {
  const cleanDetail = cleanWhatsAppErrorDetail(detail) || 'It needs a clearer next step or a bit more input.';
  return `🚫 Task blocked: ${title}\n\n${cleanDetail}`;
}

export function formatTaskNeedsInputNotice(title, detail = '', { background = false, taskId = null } = {}) {
  const header = background ? '⏳ Task waiting for approval (background)' : '⏳ Task paused — needs your input';
  const lines = [`${header}:`, title];
  if (detail) lines.push(detail);
  if (background && taskId) lines.push(`Reply \`/task run ${taskId}\` when you want me to resume.`);
  return lines.join('\n\n');
}

export function formatVerificationFailureNotice({
  title,
  verificationTarget = '',
  detail = '',
  evidence = '',
  attempts = null,
} = {}) {
  const cleanDetail = cleanWhatsAppErrorDetail(detail) || 'Verification did not pass.';
  const lines = [`❌ Task failed: ${title || 'Unnamed task'}`];
  if (verificationTarget) lines.push(`Check: ${verificationTarget}`);
  lines.push(cleanDetail);
  if (evidence) lines.push(`Evidence: ${evidence}`);
  if (Number.isFinite(attempts) && attempts > 1) lines.push(`Attempts: ${attempts}`);
  return lines.join('\n\n');
}

export function formatVerificationWarning(url, detail = '') {
  const cleanDetail = cleanWhatsAppErrorDetail(detail) || 'It may need another look.';
  return `⚠️ Verification check needs another look.\n\nTarget: ${url}\n\n${cleanDetail}`;
}

export function formatBackgroundTaskFailure(title, detail = '') {
  const cleanDetail = cleanWhatsAppErrorDetail(detail) || 'The background run hit an unexpected error.';
  return `❌ Background task failed: ${title || 'Unnamed task'}\n\n${cleanDetail}`;
}
