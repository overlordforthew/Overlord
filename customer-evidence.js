/**
 * Customer Evidence Pipeline — Track user signals across projects
 *
 * Captures: contact form submissions, support requests, user behavior signals.
 * Stores in memory DB for Overlord to query when making business decisions.
 *
 * Codex said: "Without customer evidence, the bot optimizes whatever telemetry
 * is easiest to scrape." This module fixes that.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';

const SIGNALS_PATH = '/app/data/customer-signals.json';
const SIGNALS_LOG = '/app/data/customer-signals.jsonl';

/**
 * Record a customer signal (contact form, support request, churn, etc.)
 */
export function recordSignal(signal) {
  let signals = loadSignals();

  signals.push({
    id: signals.length + 1,
    project: signal.project || null,
    type: signal.type || 'contact', // 'contact', 'support', 'churn', 'feedback', 'purchase', 'inquiry'
    email: signal.email || null,
    name: signal.name || null,
    content: (signal.content || '').substring(0, 500),
    pain: signal.pain || null, // extracted pain point
    urgency: signal.urgency || 'normal', // 'low', 'normal', 'high', 'critical'
    source: signal.source || 'unknown', // 'contact_form', 'whatsapp', 'email', 'webhook'
    metadata: signal.metadata || {},
    createdAt: new Date().toISOString(),
  });

  // Cap at 500 signals
  if (signals.length > 500) signals = signals.slice(-500);
  saveSignals(signals);

  // Also append to log for audit
  appendFileSync(SIGNALS_LOG, JSON.stringify(signals[signals.length - 1]) + '\n');

  return signals[signals.length - 1];
}

/**
 * Get recent signals for a project
 */
export function getSignals(project = null, limit = 20) {
  const signals = loadSignals();
  return signals
    .filter(s => !project || s.project === project)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, limit);
}

/**
 * Get signal summary for context injection
 */
export function getCustomerContext(project = null) {
  const signals = loadSignals();
  const recent = signals
    .filter(s => {
      const age = Date.now() - new Date(s.createdAt).getTime();
      return age < 30 * 24 * 60 * 60 * 1000; // last 30 days
    })
    .filter(s => !project || s.project === project);

  if (recent.length === 0) return '';

  // Group by project
  const byProject = {};
  for (const s of recent) {
    const p = s.project || 'unknown';
    if (!byProject[p]) byProject[p] = { count: 0, types: {}, pains: [] };
    byProject[p].count++;
    byProject[p].types[s.type] = (byProject[p].types[s.type] || 0) + 1;
    if (s.pain) byProject[p].pains.push(s.pain);
  }

  const lines = ['CUSTOMER SIGNALS (30d):'];
  for (const [p, data] of Object.entries(byProject)) {
    const typeStr = Object.entries(data.types).map(([t, c]) => `${t}:${c}`).join(', ');
    lines.push(`  ${p}: ${data.count} signals (${typeStr})`);
    if (data.pains.length > 0) {
      lines.push(`    Pains: ${[...new Set(data.pains)].slice(0, 3).join('; ')}`);
    }
  }
  return lines.join('\n');
}

/**
 * Get weekly signal stats for scorecard
 */
export function getWeeklyStats(project = null) {
  const signals = loadSignals();
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = signals.filter(s =>
    new Date(s.createdAt).getTime() > weekAgo &&
    (!project || s.project === project)
  );

  return {
    total: recent.length,
    contacts: recent.filter(s => s.type === 'contact').length,
    inquiries: recent.filter(s => s.type === 'inquiry').length,
    purchases: recent.filter(s => s.type === 'purchase').length,
    churns: recent.filter(s => s.type === 'churn').length,
  };
}

function loadSignals() {
  try { return JSON.parse(readFileSync(SIGNALS_PATH, 'utf8')); }
  catch { return []; }
}

function saveSignals(signals) {
  writeFileSync(SIGNALS_PATH, JSON.stringify(signals, null, 2));
}
