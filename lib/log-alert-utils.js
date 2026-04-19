const DB_CONTAINER_PATTERN = /(?:^|[-_])db(?:[-_]|$)/i;
const DB_QUERY_NOISE_PATTERNS = [
  /\bERROR:\s+syntax error at or near\b/i,
  /\bERROR:\s+syntax error at end of input\b/i,
  /\bERROR:\s+unterminated quoted string\b/i,
];
const STALE_DEPLOY_SERVER_ACTION_PATTERN = /\bFailed to find Server Action\b[\s\S]*\bolder or newer deployment\b/i;
const DEPLOY_SMOKE_TEST_CONTAINER_PATTERN = /\bnginx-test\b/i;
// Nginx deny rule firing on scanner probes (.env, .git, /mandrill/.env, /wp-admin, etc.).
// Fail2ban already bans these IPs — nothing actionable, just noise.
const NGINX_SCANNER_DENY_PATTERN = /\baccess forbidden by rule\b/i;
// Access-log 4xx for classic vuln-scan paths on non-PHP apps — background bot noise.
const SCANNER_404_PATTERN = /"(?:GET|POST|HEAD) \/(?:[^"]*\.(?:php|asp|aspx|cgi|jsp)|\.env|\.git|wp-(?:admin|login|content|includes)|xmlrpc|phpmyadmin|pma|phpinfo|adminer|config\.json|server-status|boaform|HNAP1|actuator|vendor\/phpunit)[^"]*" 4\d\d /i;

/** Ignore low-signal log lines that should never page WhatsApp. */
function shouldIgnoreLogLine(line, ignorePatterns) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (ignorePatterns.some((pattern) => trimmed.includes(pattern))) return true;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed.level === 'number' && parsed.level < 50) return true;
  } catch {}

  if (STALE_DEPLOY_SERVER_ACTION_PATTERN.test(trimmed)) return true;
  if (NGINX_SCANNER_DENY_PATTERN.test(trimmed)) return true;
  if (SCANNER_404_PATTERN.test(trimmed)) return true;

  const lower = trimmed.toLowerCase();
  if (lower.includes('error')) {
    if (/\berror watcher\b/i.test(trimmed)) return true;
    if (/\b(postmortem|executor|knowledge base)\b/i.test(trimmed)) return true;
    if (/^\s*[\u{1F527}\u{23F0}\u{2600}\u{1F310}\u{1F4CB}\u{1F9E0}\u{1F493}\u{1F6E1}\u{1F50D}\u{1F4CA}\u{1F916}\u{1F52E}\u{1F5DC}\u{1F441}\u{1F4E8}\u{2705}\u{1F464}\u{1F4E1}\u{1F517}]\s/u.test(trimmed)) return true;
  }

  return false;
}

/** Skip database parser/query noise without suppressing real DB failures. */
export function shouldIgnoreContainerLogLine(container, line, ignorePatterns = []) {
  if (DEPLOY_SMOKE_TEST_CONTAINER_PATTERN.test(String(container || ''))) return true;
  if (shouldIgnoreLogLine(line, ignorePatterns)) return true;
  if (DB_CONTAINER_PATTERN.test(container) && DB_QUERY_NOISE_PATTERNS.some((pattern) => pattern.test(line))) {
    return true;
  }
  return false;
}

/** Normalize timestamps and ids so repeated alerts hash to one logical issue. */
export function normalizeAlertHashText(text) {
  return text
    .split('\n')
    .map((line) => line
      .trim()
      .replace(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\s+[A-Z]+)?\s+\[\d+\]\s+/, '')
      .replace(/"time":\d+/g, '"time":<ts>')
      .replace(/"pid":\d+/g, '"pid":<pid>')
      .replace(/"hostname":"[^"]+"/g, '"hostname":"<host>"')
      .replace(/\b\d{9,}\b/g, '<id>'))
    .filter(Boolean)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();
}
