const GB = 1024 ** 3;

const SEVERITY_RANK = {
  ok: 0,
  watch: 1,
  warning: 2,
  critical: 3,
};

export function getDiskPruneThresholds(env = process.env) {
  const repeatHours = Number(env.DISK_PRUNE_REPEAT_HOURS || 6);
  return {
    warningPct: Number(env.DISK_PRUNE_WARNING_PCT || 90),
    criticalPct: Number(env.DISK_PRUNE_CRITICAL_PCT || 95),
    recoveryPct: Number(env.DISK_PRUNE_RECOVERY_PCT || 88),
    warningFreeGb: Number(env.DISK_PRUNE_WARNING_FREE_GB || 8),
    criticalFreeGb: Number(env.DISK_PRUNE_CRITICAL_FREE_GB || 5),
    repeatMs: Math.max(30 * 60 * 1000, repeatHours * 60 * 60 * 1000),
  };
}

export function parseDfBytesLine(line) {
  const parts = String(line || '').trim().split(/\s+/);
  if (parts.length < 6) return null;

  const sizeBytes = Number(parts[1]);
  const usedBytes = Number(parts[2]);
  const availBytes = Number(parts[3]);
  const usedPct = Number(String(parts[4]).replace('%', ''));

  if (![sizeBytes, usedBytes, availBytes, usedPct].every(Number.isFinite)) return null;

  return {
    filesystem: parts[0],
    sizeBytes,
    usedBytes,
    availBytes,
    usedPct,
    mount: parts.slice(5).join(' '),
  };
}

export function parseSizeToGb(value) {
  const match = String(value || '').trim().match(/^([\d.]+)\s*([KMGTPE]?i?B?)?/i);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const unit = (match[2] || 'B').toUpperCase().replace('IB', 'B');
  const factors = {
    B: 1 / GB,
    KB: 1024 / GB,
    K: 1024 / GB,
    MB: 1024 ** 2 / GB,
    M: 1024 ** 2 / GB,
    GB: 1,
    G: 1,
    TB: 1024,
    T: 1024,
    PB: 1024 ** 2,
    P: 1024 ** 2,
  };

  return amount * (factors[unit] ?? 1);
}

function parseDockerDfLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed || /^TYPE\s+/i.test(trimmed)) return null;

  const knownTypes = ['Local Volumes', 'Build Cache', 'Images', 'Containers'];
  const type = knownTypes.find((candidate) => trimmed.startsWith(candidate));
  if (!type) return null;

  const rest = trimmed.slice(type.length).trim().split(/\s+/);
  if (rest.length < 4) return null;

  return {
    type,
    total: rest[0],
    active: rest[1],
    size: rest[2],
    reclaimable: rest.slice(3).join(' '),
    reclaimableGb: parseSizeToGb(rest[3]),
  };
}

export function summarizeDockerSystemDf(output) {
  const rows = String(output || '')
    .split('\n')
    .map(parseDockerDfLine)
    .filter(Boolean);

  const reclaimable = rows
    .filter((row) => row.reclaimable && row.reclaimableGb !== null && row.reclaimableGb > 0)
    .sort((a, b) => b.reclaimableGb - a.reclaimableGb);

  return { rows, reclaimable };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'unknown';
  const abs = Math.abs(bytes);
  if (abs >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`;
  if (abs >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (abs >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes)} B`;
}

export function classifyDiskPressure(disk, thresholds = getDiskPruneThresholds()) {
  if (!disk) {
    return {
      level: 'unknown',
      shouldAlert: false,
      reason: 'Root disk usage could not be read.',
    };
  }

  const freeGb = disk.availBytes / GB;
  if (disk.usedPct >= thresholds.criticalPct || freeGb <= thresholds.criticalFreeGb) {
    return {
      level: 'critical',
      shouldAlert: true,
      reason: disk.usedPct >= thresholds.criticalPct
        ? `Root disk is at ${disk.usedPct}%.`
        : `Root disk has only ${freeGb.toFixed(1)} GB free.`,
    };
  }

  if (disk.usedPct >= thresholds.warningPct || freeGb <= thresholds.warningFreeGb) {
    return {
      level: 'warning',
      shouldAlert: true,
      reason: disk.usedPct >= thresholds.warningPct
        ? `Root disk is at ${disk.usedPct}%.`
        : `Root disk has only ${freeGb.toFixed(1)} GB free.`,
    };
  }

  if (disk.usedPct <= thresholds.recoveryPct) {
    return {
      level: 'ok',
      shouldAlert: false,
      reason: `Root disk is back below ${thresholds.recoveryPct}%.`,
    };
  }

  return {
    level: 'watch',
    shouldAlert: false,
    reason: `Root disk is at ${disk.usedPct}%, below alert threshold.`,
  };
}

export function shouldSendDiskPruneAlert(state = {}, classification, disk, thresholds = getDiskPruneThresholds(), nowMs = Date.now()) {
  const previousLevel = state.lastLevel || 'ok';
  const previousRank = SEVERITY_RANK[previousLevel] ?? 0;
  const currentRank = SEVERITY_RANK[classification?.level] ?? 0;
  const parsedLastAlertAtMs = state.lastAlertAt ? Date.parse(state.lastAlertAt) : 0;
  const lastAlertAtMs = Number.isFinite(parsedLastAlertAtMs) ? parsedLastAlertAtMs : 0;
  const lastUsedPct = Number(state.lastUsedPct);

  if (classification?.shouldAlert) {
    if (!lastAlertAtMs) {
      return { send: true, kind: 'alert', reason: 'first_alert' };
    }
    if (currentRank > previousRank) {
      return { send: true, kind: 'alert', reason: 'severity_escalated' };
    }
    if (Number.isFinite(disk?.usedPct) && Number.isFinite(lastUsedPct) && disk.usedPct >= lastUsedPct + 2) {
      return { send: true, kind: 'alert', reason: 'usage_increased' };
    }
    if (nowMs - lastAlertAtMs >= thresholds.repeatMs) {
      return { send: true, kind: 'alert', reason: 'repeat_cooldown_elapsed' };
    }
    return { send: false, kind: 'alert', reason: 'cooldown' };
  }

  if ((SEVERITY_RANK[previousLevel] ?? 0) >= SEVERITY_RANK.warning && classification?.level === 'ok') {
    return { send: true, kind: 'recovery', reason: 'recovered' };
  }

  return { send: false, kind: 'none', reason: 'healthy' };
}

export function updateDiskPruneAlertState(state = {}, classification, disk, decision, nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  const next = {
    ...state,
    lastCheckedAt: nowIso,
    lastLevel: classification?.level || 'unknown',
    lastReason: classification?.reason || '',
    lastUsedPct: disk?.usedPct ?? null,
    lastAvailBytes: disk?.availBytes ?? null,
  };

  if (decision?.send && decision.kind === 'alert') {
    next.lastAlertAt = nowIso;
  }
  if (decision?.send && decision.kind === 'recovery') {
    next.lastRecoveryAt = nowIso;
  }

  return next;
}

function formatDockerReclaimable(dockerSummary) {
  if (dockerSummary?.unavailable) {
    return 'Docker reclaimable snapshot is unavailable from inside Overlord. Run `docker system df` on the host before pruning.';
  }

  const items = dockerSummary?.reclaimable || [];
  if (items.length === 0) return 'Docker did not report obvious reclaimable space.';

  return items
    .slice(0, 4)
    .map((item) => `- ${item.type}: ${item.reclaimable} reclaimable`)
    .join('\n');
}

export function buildDiskPruneAlertMessage({ disk, dockerSummary, classification, thresholds = getDiskPruneThresholds(), generatedAt = new Date() }) {
  const level = classification?.level === 'critical' ? 'CRITICAL' : 'WARNING';
  const icon = classification?.level === 'critical' ? '🚨' : '⚠️';
  const freeText = formatBytes(disk?.availBytes);
  const usedText = formatBytes(disk?.usedBytes);
  const totalText = formatBytes(disk?.sizeBytes);

  return [
    `${icon} Disk prune alert — ${level}`,
    '',
    `Root disk: ${disk?.usedPct ?? '?'}% full (${usedText} used / ${totalText}, ${freeText} free).`,
    `Why this matters: low root disk can make Postgres fail writes/checkpoints and can flip apps into 503s.`,
    '',
    'Safe prune order:',
    '1. docker builder prune -af',
    '2. docker image prune -f',
    '3. npm cache clean --force && rm -rf /root/.npm/_npx',
    '4. go clean -cache && python3 -m pip cache purge',
    '',
    'Avoid unless we explicitly confirm it:',
    '- docker volume prune',
    '- deleting live database or app volumes',
    '',
    'Docker reclaimable snapshot:',
    formatDockerReclaimable(dockerSummary),
    '',
    `Alert policy: warning at ${thresholds.warningPct}% or <${thresholds.warningFreeGb} GB free; critical at ${thresholds.criticalPct}% or <${thresholds.criticalFreeGb} GB free. Repeats every ${Math.round(thresholds.repeatMs / 3600000)}h while high.`,
    `Checked: ${generatedAt.toISOString()}`,
  ].join('\n');
}

export function buildDiskPruneRecoveryMessage({ disk, thresholds = getDiskPruneThresholds(), generatedAt = new Date() }) {
  return [
    '✅ Disk pressure recovered',
    '',
    `Root disk is now ${disk?.usedPct ?? '?'}% full (${formatBytes(disk?.availBytes)} free).`,
    `This is back under the recovery threshold (${thresholds.recoveryPct}%). I will stay quiet unless it climbs again.`,
    '',
    `Checked: ${generatedAt.toISOString()}`,
  ].join('\n');
}
