/**
 * meta-learning.js — Nine Loops engine for Overlord
 *
 * Implements persistent learning across sessions:
 * 1. Regressions List — track and avoid repeated mistakes
 * 2. Friction Tracking — log slowdowns and failures
 * 3. Daily Synthesis — consolidate learnings nightly
 * 4. Performance Trending — track metrics over time
 * 5. Self-Observation — analyze session traces
 *
 * Loops 3 (prediction-outcome), 6 (cooperative refinement),
 * 8 (rule evolution) are future work requiring deeper architecture changes.
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const META_DIR = path.join(DATA_DIR, 'meta-learning');
const REGRESSIONS_FILE = path.join(META_DIR, 'regressions.json');
const FRICTION_FILE = path.join(META_DIR, 'friction.json');
const TRENDS_FILE = path.join(META_DIR, 'trends.json');
const SYNTHESIS_DIR = path.join(META_DIR, 'synthesis');

// Ensure directories exist
if (!existsSync(META_DIR)) mkdirSync(META_DIR, { recursive: true });
if (!existsSync(SYNTHESIS_DIR)) mkdirSync(SYNTHESIS_DIR, { recursive: true });

async function readJSON(file, fallback) {
  try {
    const data = await fs.readFile(file, 'utf-8');
    return JSON.parse(data);
  } catch {
    return fallback;
  }
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// ============================================================
// LOOP 1: REGRESSIONS LIST
// ============================================================

/**
 * Log a regression (a mistake or failure pattern to avoid).
 * @param {string} category - e.g., "deploy", "api", "config", "response"
 * @param {string} description - What went wrong
 * @param {string} resolution - How it was fixed
 * @param {string} avoidance - How to avoid it next time
 */
export async function logRegression(category, description, resolution, avoidance) {
  const regressions = await readJSON(REGRESSIONS_FILE, { entries: [], stats: {} });

  regressions.entries.push({
    id: Date.now().toString(36),
    category,
    description,
    resolution,
    avoidance,
    timestamp: new Date().toISOString(),
    hitCount: 0,
  });

  // Keep last 200 entries
  if (regressions.entries.length > 200) {
    regressions.entries = regressions.entries.slice(-200);
  }

  // Update category stats
  regressions.stats[category] = (regressions.stats[category] || 0) + 1;

  await writeJSON(REGRESSIONS_FILE, regressions);
  return regressions.entries[regressions.entries.length - 1];
}

/**
 * Check regressions before performing an action.
 * Returns matching regression entries for the given category/keywords.
 */
export async function checkRegressions(category, keywords = '') {
  const regressions = await readJSON(REGRESSIONS_FILE, { entries: [], stats: {} });
  const kw = keywords.toLowerCase();

  return regressions.entries.filter(r =>
    r.category === category ||
    r.description.toLowerCase().includes(kw) ||
    (kw && r.avoidance.toLowerCase().includes(kw))
  ).slice(-5); // Last 5 relevant
}

/**
 * Get regression summary for system prompt injection.
 * Returns a concise string of recent patterns to avoid.
 */
export async function getRegressionSummary() {
  const regressions = await readJSON(REGRESSIONS_FILE, { entries: [], stats: {} });
  if (regressions.entries.length === 0) return '';

  const recent = regressions.entries.slice(-10);
  const lines = recent.map(r => `- [${r.category}] ${r.avoidance}`);
  return `\n[KNOWN REGRESSIONS — avoid these patterns]\n${lines.join('\n')}`;
}

// ============================================================
// LOOP 4: FRICTION TRACKING
// ============================================================

/**
 * Log a friction event (slowdown, failure, timeout, user retry).
 */
export async function logFriction(type, details, durationMs = null) {
  const friction = await readJSON(FRICTION_FILE, { events: [], summary: {} });

  friction.events.push({
    type, // "slow_response", "api_error", "timeout", "user_retry", "tool_failure"
    details,
    durationMs,
    timestamp: new Date().toISOString(),
  });

  // Keep last 500 events
  if (friction.events.length > 500) {
    friction.events = friction.events.slice(-500);
  }

  // Update summary counts
  friction.summary[type] = (friction.summary[type] || 0) + 1;

  await writeJSON(FRICTION_FILE, friction);
}

/**
 * Get friction report for the last N hours.
 */
export async function getFrictionReport(hours = 24) {
  const friction = await readJSON(FRICTION_FILE, { events: [], summary: {} });
  const cutoff = Date.now() - hours * 3600000;

  const recent = friction.events.filter(e => new Date(e.timestamp).getTime() > cutoff);

  // Group by type
  const byType = {};
  for (const e of recent) {
    if (!byType[e.type]) byType[e.type] = [];
    byType[e.type].push(e);
  }

  const lines = [];
  for (const [type, events] of Object.entries(byType)) {
    const avgDuration = events.filter(e => e.durationMs).reduce((a, e) => a + e.durationMs, 0) / events.length;
    lines.push(`${type}: ${events.length} events${avgDuration ? ` (avg ${Math.round(avgDuration)}ms)` : ''}`);
  }

  return {
    total: recent.length,
    byType,
    summary: lines.join('\n'),
    allTimeSummary: friction.summary,
  };
}

// ============================================================
// LOOP 5: DAILY SYNTHESIS
// ============================================================

/**
 * Generate nightly synthesis from the day's events.
 * Called by scheduler at 11pm.
 */
export async function generateDailySynthesis() {
  const today = new Date().toISOString().split('T')[0];
  const synthFile = path.join(SYNTHESIS_DIR, `${today}.json`);

  // Gather data from all sources
  const regressions = await readJSON(REGRESSIONS_FILE, { entries: [], stats: {} });
  const friction = await readJSON(FRICTION_FILE, { events: [], summary: {} });
  const trends = await readJSON(TRENDS_FILE, { daily: [] });

  // Today's regressions
  const todayRegressions = regressions.entries.filter(r =>
    r.timestamp && r.timestamp.startsWith(today)
  );

  // Today's friction
  const todayFriction = friction.events.filter(e =>
    e.timestamp && e.timestamp.startsWith(today)
  );

  // Friction by type
  const frictionByType = {};
  for (const e of todayFriction) {
    frictionByType[e.type] = (frictionByType[e.type] || 0) + 1;
  }

  // Build synthesis
  const synthesis = {
    date: today,
    generatedAt: new Date().toISOString(),
    regressions: {
      count: todayRegressions.length,
      categories: [...new Set(todayRegressions.map(r => r.category))],
      items: todayRegressions.map(r => ({
        category: r.category,
        avoidance: r.avoidance,
      })),
    },
    friction: {
      totalEvents: todayFriction.length,
      byType: frictionByType,
      topIssue: Object.entries(frictionByType).sort((a, b) => b[1] - a[1])[0]?.[0] || 'none',
    },
    insights: [],
  };

  // Generate insights
  if (todayFriction.length > 20) {
    synthesis.insights.push(`High friction day: ${todayFriction.length} events. Check for systemic issues.`);
  }
  if (todayRegressions.length > 0) {
    synthesis.insights.push(`${todayRegressions.length} new regressions logged. Review avoidance rules.`);
  }
  if (frictionByType['timeout'] > 3) {
    synthesis.insights.push(`${frictionByType['timeout']} timeouts today — possible performance degradation.`);
  }
  if (frictionByType['api_error'] > 5) {
    synthesis.insights.push(`${frictionByType['api_error']} API errors — check rate limits or credentials.`);
  }

  await writeJSON(synthFile, synthesis);
  return synthesis;
}

/**
 * Format synthesis for WhatsApp message.
 */
export function formatSynthesisMessage(synthesis) {
  const lines = [`🧠 Daily Learning Synthesis — ${synthesis.date}`, ''];

  if (synthesis.regressions.count > 0) {
    lines.push(`📋 New regressions: ${synthesis.regressions.count}`);
    for (const item of synthesis.regressions.items.slice(0, 5)) {
      lines.push(`  • [${item.category}] ${item.avoidance}`);
    }
    lines.push('');
  }

  if (synthesis.friction.totalEvents > 0) {
    lines.push(`⚡ Friction events: ${synthesis.friction.totalEvents}`);
    for (const [type, count] of Object.entries(synthesis.friction.byType)) {
      lines.push(`  • ${type}: ${count}`);
    }
    lines.push('');
  }

  if (synthesis.insights.length > 0) {
    lines.push('💡 Insights:');
    for (const insight of synthesis.insights) {
      lines.push(`  • ${insight}`);
    }
  } else {
    lines.push('✅ Clean day — no notable patterns.');
  }

  return lines.join('\n');
}

// ============================================================
// LOOP 9: PERFORMANCE TRENDING
// ============================================================

/**
 * Record daily performance metrics snapshot.
 */
export async function recordDailyMetrics(metrics) {
  const trends = await readJSON(TRENDS_FILE, { daily: [] });

  trends.daily.push({
    date: new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    ...metrics,
  });

  // Keep last 90 days
  if (trends.daily.length > 90) {
    trends.daily = trends.daily.slice(-90);
  }

  await writeJSON(TRENDS_FILE, trends);
  return trends;
}

/**
 * Get performance trend analysis.
 */
export async function getTrendAnalysis(days = 7) {
  const trends = await readJSON(TRENDS_FILE, { daily: [] });
  const recent = trends.daily.slice(-days);

  if (recent.length < 2) return { summary: 'Not enough data for trending yet.', data: recent };

  // Analyze trends for numeric fields
  const analysis = {};
  const numericKeys = Object.keys(recent[0]).filter(k =>
    k !== 'date' && k !== 'timestamp' && typeof recent[0][k] === 'number'
  );

  for (const key of numericKeys) {
    const values = recent.map(r => r[key]).filter(v => v != null);
    if (values.length < 2) continue;

    const first = values[0];
    const last = values[values.length - 1];
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const change = last - first;
    const pctChange = first !== 0 ? ((change / first) * 100).toFixed(1) : 'N/A';

    analysis[key] = {
      current: last,
      average: Math.round(avg * 100) / 100,
      change,
      pctChange: `${pctChange}%`,
      trend: change > 0 ? 'UP' : change < 0 ? 'DOWN' : 'STABLE',
    };
  }

  return { summary: formatTrendSummary(analysis), data: recent, analysis };
}

function formatTrendSummary(analysis) {
  const lines = [];
  for (const [key, data] of Object.entries(analysis)) {
    const arrow = data.trend === 'UP' ? '↑' : data.trend === 'DOWN' ? '↓' : '→';
    lines.push(`${key}: ${data.current} (${arrow} ${data.pctChange} over period, avg ${data.average})`);
  }
  return lines.join('\n');
}

/**
 * Load yesterday's synthesis and return a compact string for system prompt injection.
 * Returns empty string if no synthesis available or nothing noteworthy.
 */
export async function getYesterdaySynthesisContext() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const file = path.join(SYNTHESIS_DIR, `${yesterday}.json`);
  try {
    const synthesis = await readJSON(file, null);
    if (!synthesis) return '';

    const lines = [];
    if (synthesis.insights?.length > 0) {
      lines.push('[YESTERDAY\'S LEARNINGS]');
      for (const insight of synthesis.insights) lines.push(`• ${insight}`);
    }
    if (synthesis.regressions?.items?.length > 0) {
      if (lines.length === 0) lines.push('[YESTERDAY\'S LEARNINGS]');
      for (const item of synthesis.regressions.items) {
        lines.push(`• Avoid [${item.category}]: ${item.avoidance}`);
      }
    }
    return lines.length > 0 ? lines.join(' ') : '';
  } catch {
    return '';
  }
}
