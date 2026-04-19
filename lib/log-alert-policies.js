function normalizeTargetSegment(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'unknown';
}

export function getAlertPolicyTarget(alert = {}) {
  const friendly = String(alert.friendly || '').trim();
  if (friendly) return friendly;

  const container = String(alert.container || '').trim();
  if (!container) return 'unknown';

  return container
    .replace(/^[a-f0-9]{12}_/u, '')
    .replace(/-\d{9,}$/u, '');
}

export function buildAlertSignalKey(alert = {}, family = 'unknown') {
  return `log-page:${normalizeTargetSegment(getAlertPolicyTarget(alert))}:${family}`;
}

export function getTransientAlertThresholdPolicy(alert = {}) {
  const errorText = `${alert.errorText || ''}\n${alert.analysis?.rootCause || ''}`;
  const containerText = `${alert.container || ''}\n${alert.friendly || ''}`;

  if (
    /\bhl-dashboard\b/i.test(containerText) &&
    /(api\.hyperliquid\.xyz|bad gateway|read timed out|cloudfront)/i.test(errorText)
  ) {
    return {
      family: 'hyperliquid-upstream',
      minHits: 3,
      windowMs: 5 * 60 * 1000,
      cooldownMs: 30 * 60 * 1000,
      recoveryWindowMs: 15 * 60 * 1000,
    };
  }

  if (/\bAll weather providers failed\b/i.test(errorText)) {
    return {
      family: 'weather-provider-upstream',
      minHits: 3,
      windowMs: 15 * 60 * 1000,
      cooldownMs: 60 * 60 * 1000,
      recoveryWindowMs: 30 * 60 * 1000,
    };
  }

  if (/\bgetaddrinfo EAI_AGAIN db\b/i.test(errorText)) {
    return {
      family: 'startup-db-dns',
      minHits: 4,
      windowMs: 10 * 60 * 1000,
      cooldownMs: 2 * 60 * 60 * 1000,
      recoveryWindowMs: 20 * 60 * 1000,
    };
  }

  if (/\b(OpenRouter HTTP 401|Error code: 401)\b[\s\S]*\bUser not found\b/i.test(errorText)) {
    return {
      family: 'openrouter-auth',
      minHits: 3,
      windowMs: 20 * 60 * 1000,
      cooldownMs: 6 * 60 * 60 * 1000,
      recoveryWindowMs: 60 * 60 * 1000,
    };
  }

  if (/\bviolates foreign key constraint "(?:anchor_log|safety_events)_boat_id_fkey"/i.test(errorText)) {
    return {
      family: 'boat-fk-violation',
      minHits: 4,
      windowMs: 20 * 60 * 1000,
      cooldownMs: 12 * 60 * 60 * 1000,
      recoveryWindowMs: 30 * 60 * 1000,
    };
  }

  return null;
}

export function describeTransientAlertLifecycle(alert = {}, policy = getTransientAlertThresholdPolicy(alert)) {
  if (!policy) return null;

  const service = getAlertPolicyTarget(alert);

  switch (policy.family) {
    case 'hyperliquid-upstream':
      return {
        key: buildAlertSignalKey(alert, policy.family),
        service,
        family: policy.family,
        degradedTitle: `${service} live market data`,
        degradedDetail: 'Upstream market data is unstable. Retries and cached state are covering where possible.',
        recoveredTitle: `${service} live market data`,
        recoveredDetail: 'Upstream market data stabilized and fresh responses resumed.',
        recoveryWindowMs: policy.recoveryWindowMs,
      };
    case 'weather-provider-upstream':
      return {
        key: buildAlertSignalKey(alert, policy.family),
        service,
        family: policy.family,
        degradedTitle: `${service} weather updates`,
        degradedDetail: 'Upstream weather providers are failing, so fresh forecasts may be delayed.',
        recoveredTitle: `${service} weather updates`,
        recoveredDetail: 'Forecast providers recovered and fresh weather updates resumed.',
        recoveryWindowMs: policy.recoveryWindowMs,
      };
    case 'startup-db-dns':
      return {
        key: buildAlertSignalKey(alert, policy.family),
        service,
        family: policy.family,
        degradedTitle: `${service} startup`,
        degradedDetail: 'The service cannot reliably reach its database yet, so startup is delayed.',
        recoveredTitle: `${service} startup`,
        recoveredDetail: 'Database connectivity recovered and startup stabilized.',
        recoveryWindowMs: policy.recoveryWindowMs,
      };
    case 'openrouter-auth':
      return {
        key: buildAlertSignalKey(alert, policy.family),
        service,
        family: policy.family,
        degradedTitle: `${service} AI features`,
        degradedDetail: 'The AI provider is rejecting requests, so AI-assisted features are degraded.',
        recoveredTitle: `${service} AI features`,
        recoveredDetail: 'AI provider access recovered and requests are succeeding again.',
        recoveryWindowMs: policy.recoveryWindowMs,
      };
    case 'boat-fk-violation':
      return {
        key: buildAlertSignalKey(alert, policy.family),
        service,
        family: policy.family,
        degradedTitle: `${service} safety logging`,
        degradedDetail: 'Safety or anchor events are failing to save correctly, so recent safety records may be incomplete.',
        recoveredTitle: `${service} safety logging`,
        recoveredDetail: 'Safety and anchor event writes resumed normally.',
        recoveryWindowMs: policy.recoveryWindowMs,
      };
    default:
      return {
        key: buildAlertSignalKey(alert, policy.family),
        service,
        family: policy.family,
        degradedTitle: `${service} service health`,
        degradedDetail: 'A sustained service issue was detected.',
        recoveredTitle: `${service} service health`,
        recoveredDetail: 'The sustained service issue cleared.',
        recoveryWindowMs: policy.recoveryWindowMs || (15 * 60 * 1000),
      };
  }
}
