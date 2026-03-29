#!/usr/bin/env node
/**
 * weekly-skill-review.mjs — Weekly Skill Review Protocol
 *
 * Runs every Sunday at 7pm AST (23:00 UTC), before Starlink goes down at 9pm.
 * Aggregates a full week of data across all Overlord systems:
 *
 * 1. Pulse feedback — quality scores per skill/entity
 * 2. Pulse events — usage patterns, slow responses, API errors
 * 3. Cortex annotations — persistent notes flagging issues
 * 4. Cortex feedback — up/down ratings and health scores
 * 5. Meta-learning friction — slowdowns and failures
 * 6. Meta-learning regressions — mistake patterns to avoid
 * 7. Skill inventory — 69 installed skills, status, gaps
 *
 * Generates a JSON report saved to /app/data/skill-reviews/
 * and outputs a WhatsApp-formatted summary.
 *
 * Usage:
 *   node weekly-skill-review.mjs              Run full review, output report
 *   node weekly-skill-review.mjs --json       Output raw JSON only
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import path from 'path';

// ── PATHS ────────────────────────────────────────────────────────────────────

const DATA_DIR = '/app/data';
const REVIEWS_DIR = path.join(DATA_DIR, 'skill-reviews');
const PULSE_DIR = path.join(DATA_DIR, 'pulse');
const META_DIR = path.join(DATA_DIR, 'meta-learning');
const CORTEX_DIR = path.join(DATA_DIR, 'cortex');
const SKILLS_DIR = '/app/skills';

// Ensure output directory exists
if (!existsSync(REVIEWS_DIR)) mkdirSync(REVIEWS_DIR, { recursive: true });

// ── HELPERS ──────────────────────────────────────────────────────────────────

function readJSON(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function weekAgo() {
  return new Date(Date.now() - 7 * 24 * 3600 * 1000);
}

function isThisWeek(timestamp) {
  if (!timestamp) return false;
  return new Date(timestamp).getTime() >= weekAgo().getTime();
}

// ── DATA COLLECTORS ──────────────────────────────────────────────────────────

/**
 * Collect Pulse feedback data — quality scores per entity
 */
function collectPulseFeedback() {
  const feedback = readJSON(path.join(PULSE_DIR, 'feedback.json'), {});
  const results = [];

  for (const [name, data] of Object.entries(feedback)) {
    const weekEntries = (data.entries || []).filter(e => isThisWeek(e.at));
    const weekUp = weekEntries.filter(e => e.rating === 'up').length;
    const weekDown = weekEntries.filter(e => e.rating === 'down').length;
    const total = data.up + data.down;
    const score = total > 0 ? Math.round((data.up / total) * 100) : null;

    results.push({
      name,
      allTimeUp: data.up,
      allTimeDown: data.down,
      allTimeScore: score,
      weekUp,
      weekDown,
      weekTotal: weekUp + weekDown,
      weekScore: (weekUp + weekDown) > 0
        ? Math.round((weekUp / (weekUp + weekDown)) * 100)
        : null,
      recentLabels: weekEntries.flatMap(e => e.labels || []),
    });
  }

  return results.sort((a, b) => b.weekTotal - a.weekTotal);
}

/**
 * Collect Pulse events — usage patterns, error types, performance
 */
function collectPulseEvents() {
  // Pulse events.json is a flat array with { name, outcome, comment, at } entries
  const rawEvents = readJSON(path.join(PULSE_DIR, 'events.json'), []);
  const allEvents = Array.isArray(rawEvents) ? rawEvents : (rawEvents.events || []);
  const weekEvents = allEvents.filter(e => isThisWeek(e.at || e.timestamp));

  // Group by name prefix (e.g., "task:repair" → "task", "deploy:namibarden" → "deploy", "skill:research" → "skill")
  const byType = {};
  for (const e of weekEvents) {
    const type = (e.name || '').split(':')[0] || 'unknown';
    if (!byType[type]) byType[type] = [];
    byType[type].push(e);
  }

  // Count failures (outcome !== 'up')
  const failures = weekEvents.filter(e => e.outcome !== 'up');

  return {
    totalEvents: weekEvents.length,
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.length])),
    performance: {
      slowResponseCount: 0,
      avgResponseMs: 0,
      maxResponseMs: 0,
    },
    apiErrors: failures.length,
    allTimeSummary: { total: allEvents.length },
  };
}

/**
 * Collect Cortex annotations — persistent notes flagging issues
 */
function collectCortexAnnotations() {
  const annotationsDir = path.join(CORTEX_DIR, 'annotations');
  if (!existsSync(annotationsDir)) return [];

  try {
    const files = readdirSync(annotationsDir).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        return JSON.parse(readFileSync(path.join(annotationsDir, f), 'utf8'));
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Collect Cortex registry — tracked entities and health scores
 */
function collectCortexRegistry() {
  const registry = readJSON(path.join(CORTEX_DIR, 'registry.json'), {
    entities: [], inProgress: [], failed: [],
  });
  return registry;
}

/**
 * Collect Cortex feedback (quality tracking)
 */
function collectCortexFeedback() {
  const feedback = readJSON(path.join(CORTEX_DIR, 'feedback.json'), {});
  const results = [];

  for (const [name, data] of Object.entries(feedback)) {
    const total = data.up + data.down;
    const score = total > 0 ? Math.round((data.up / total) * 100) : null;
    const weekEntries = (data.entries || []).filter(e => isThisWeek(e.at));

    if (score !== null && score < 60) {
      results.push({
        name,
        score,
        upCount: data.up,
        downCount: data.down,
        weekActivity: weekEntries.length,
        recentIssues: weekEntries
          .filter(e => e.rating === 'down')
          .flatMap(e => e.labels || []),
      });
    }
  }

  return results.sort((a, b) => (a.score || 0) - (b.score || 0));
}

/**
 * Collect meta-learning friction events for the week
 */
function collectFriction() {
  const friction = readJSON(path.join(META_DIR, 'friction.json'), { events: [], summary: {} });
  const weekEvents = (friction.events || []).filter(e => isThisWeek(e.timestamp));

  const byType = {};
  for (const e of weekEvents) {
    if (!byType[e.type]) byType[e.type] = { count: 0, totalMs: 0 };
    byType[e.type].count++;
    if (e.durationMs) byType[e.type].totalMs += e.durationMs;
  }

  // Calculate averages
  for (const [, v] of Object.entries(byType)) {
    v.avgMs = v.count > 0 ? Math.round(v.totalMs / v.count) : 0;
  }

  return {
    totalEvents: weekEvents.length,
    byType,
    allTimeSummary: friction.summary,
  };
}

/**
 * Collect meta-learning regressions for the week
 */
function collectRegressions() {
  const data = readJSON(path.join(META_DIR, 'regressions.json'), { entries: [], stats: {} });
  const weekEntries = (data.entries || []).filter(e => isThisWeek(e.timestamp));

  return {
    weekCount: weekEntries.length,
    entries: weekEntries.map(r => ({
      category: r.category,
      description: r.description?.substring(0, 120),
      avoidance: r.avoidance?.substring(0, 120),
    })),
    allTimeStats: data.stats,
  };
}

/**
 * Collect daily synthesis summaries for the week
 */
function collectWeeklySyntheses() {
  const synthDir = path.join(META_DIR, 'synthesis');
  if (!existsSync(synthDir)) return [];

  const cutoff = weekAgo();
  const results = [];

  try {
    const files = readdirSync(synthDir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const dateStr = f.replace('.json', '');
      if (new Date(dateStr) >= cutoff) {
        const synth = readJSON(path.join(synthDir, f), null);
        if (synth) results.push(synth);
      }
    }
  } catch { /* ignore */ }

  return results.sort((a, b) => a.date?.localeCompare(b.date));
}

/**
 * Collect performance trends for the week
 */
function collectTrends() {
  const trends = readJSON(path.join(META_DIR, 'trends.json'), { daily: [] });
  const cutoff = weekAgo();
  const weekData = trends.daily.filter(d => new Date(d.timestamp) >= cutoff);

  if (weekData.length < 2) return { summary: 'Insufficient data', data: weekData };

  const metrics = {};
  const numericKeys = Object.keys(weekData[0]).filter(k =>
    k !== 'date' && k !== 'timestamp' && typeof weekData[0][k] === 'number'
  );

  for (const key of numericKeys) {
    const values = weekData.map(d => d[key]).filter(v => v != null);
    if (values.length < 2) continue;

    const avg = Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const trend = values[values.length - 1] - values[0];

    metrics[key] = { avg, min, max, trend: trend > 0 ? 'UP' : trend < 0 ? 'DOWN' : 'STABLE' };
  }

  return { metrics, data: weekData };
}

/**
 * Collect skill inventory
 */
function collectSkillInventory() {
  try {
    const dirs = readdirSync(SKILLS_DIR).filter(f => {
      try {
        const stat = readFileSync(path.join(SKILLS_DIR, f, 'CLAUDE.md'), 'utf-8');
        return true;
      } catch {
        // Check if it's a directory (has any content)
        try {
          readdirSync(path.join(SKILLS_DIR, f));
          return true;
        } catch {
          return false;
        }
      }
    });

    return {
      totalCount: dirs.length,
      skills: dirs.sort(),
    };
  } catch {
    return { totalCount: 0, skills: [] };
  }
}

// ── ANALYSIS ─────────────────────────────────────────────────────────────────

function generateRecommendations(report) {
  const recommendations = [];

  // High friction
  if (report.friction.totalEvents > 30) {
    recommendations.push({
      priority: 'high',
      area: 'performance',
      recommendation: `${report.friction.totalEvents} friction events this week. Investigate recurring patterns in slow_response and api_error types.`,
    });
  }

  // Slow response performance
  if (report.pulseEvents.performance.avgResponseMs > 120000) {
    recommendations.push({
      priority: 'high',
      area: 'performance',
      recommendation: `Average slow response is ${Math.round(report.pulseEvents.performance.avgResponseMs / 1000)}s. Consider optimizing heavy skills or adding timeouts.`,
    });
  }

  // Underperforming entities from cortex
  for (const entity of report.cortexUnderperforming) {
    recommendations.push({
      priority: 'medium',
      area: 'quality',
      recommendation: `${entity.name} has ${entity.score}% quality score (${entity.downCount} issues). Review and fix: ${entity.recentIssues.join(', ') || 'unspecified issues'}.`,
    });
  }

  // New regressions
  if (report.regressions.weekCount > 0) {
    const categories = [...new Set(report.regressions.entries.map(e => e.category))];
    recommendations.push({
      priority: 'medium',
      area: 'reliability',
      recommendation: `${report.regressions.weekCount} new regression(s) in: ${categories.join(', ')}. Review avoidance rules.`,
    });
  }

  // Cortex annotations with issues
  const issueAnnotations = report.cortexAnnotations.filter(a => {
    const issueWords = ['broken', 'fails', 'outdated', 'fix', 'bug', 'wrong', 'error'];
    return issueWords.some(w => (a.note || '').toLowerCase().includes(w));
  });
  if (issueAnnotations.length > 0) {
    recommendations.push({
      priority: 'medium',
      area: 'maintenance',
      recommendation: `${issueAnnotations.length} annotation(s) flagging issues: ${issueAnnotations.map(a => a.entity).join(', ')}.`,
    });
  }

  // API errors trending up
  if (report.pulseEvents.apiErrors > 3) {
    recommendations.push({
      priority: 'medium',
      area: 'reliability',
      recommendation: `${report.pulseEvents.apiErrors} API errors this week. Check rate limits, credentials, and retry logic.`,
    });
  }

  // Infrastructure trends
  const trends = report.trends.metrics || {};
  if (trends.diskUsagePct?.trend === 'UP' && trends.diskUsagePct?.avg > 50) {
    recommendations.push({
      priority: 'medium',
      area: 'infrastructure',
      recommendation: `Disk usage trending up (avg ${trends.diskUsagePct.avg}%, peak ${trends.diskUsagePct.max}%). Consider cleanup.`,
    });
  }
  if (trends.memoryUsagePct?.trend === 'UP' && trends.memoryUsagePct?.avg > 50) {
    recommendations.push({
      priority: 'high',
      area: 'infrastructure',
      recommendation: `Memory usage trending up (avg ${trends.memoryUsagePct.avg}%, peak ${trends.memoryUsagePct.max}%). Investigate container memory leaks.`,
    });
  }

  // Friction trend from daily syntheses
  const highFrictionDays = report.dailySyntheses.filter(s => s.friction?.totalEvents > 15);
  if (highFrictionDays.length >= 3) {
    recommendations.push({
      priority: 'high',
      area: 'reliability',
      recommendation: `${highFrictionDays.length} high-friction days this week. Systemic issue likely — review root causes.`,
    });
  }

  return recommendations.sort((a, b) => {
    const p = { high: 0, medium: 1, low: 2 };
    return (p[a.priority] || 2) - (p[b.priority] || 2);
  });
}

function identifyGotchas(report) {
  const gotchas = [];

  // From regressions
  for (const r of report.regressions.entries) {
    gotchas.push({
      source: 'regression',
      category: r.category,
      description: r.avoidance || r.description,
    });
  }

  // From annotations with issue keywords
  for (const a of report.cortexAnnotations) {
    const issueWords = ['broken', 'fails', 'outdated', 'fix', 'bug', 'wrong', 'error', 'gotcha', 'caveat', 'workaround'];
    if (issueWords.some(w => (a.note || '').toLowerCase().includes(w))) {
      gotchas.push({
        source: 'annotation',
        category: a.type || 'unknown',
        description: `${a.entity}: ${(a.note || '').substring(0, 120)}`,
      });
    }
  }

  // From daily synthesis insights
  for (const s of report.dailySyntheses) {
    for (const insight of (s.insights || [])) {
      gotchas.push({
        source: 'synthesis',
        category: 'daily',
        description: `[${s.date}] ${insight}`,
      });
    }
  }

  return gotchas;
}

// ── REPORT GENERATION ────────────────────────────────────────────────────────

function generateReport() {
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

  const report = {
    period: {
      start: weekStart.toISOString().split('T')[0],
      end: now.toISOString().split('T')[0],
      generatedAt: now.toISOString(),
    },
    skillInventory: collectSkillInventory(),
    pulseFeedback: collectPulseFeedback(),
    pulseEvents: collectPulseEvents(),
    cortexRegistry: collectCortexRegistry(),
    cortexAnnotations: collectCortexAnnotations(),
    cortexUnderperforming: collectCortexFeedback(),
    friction: collectFriction(),
    regressions: collectRegressions(),
    dailySyntheses: collectWeeklySyntheses(),
    trends: collectTrends(),
  };

  report.gotchas = identifyGotchas(report);
  report.recommendations = generateRecommendations(report);

  return report;
}

function formatWhatsAppSummary(report) {
  const lines = [
    `📊 *Weekly Skill Review*`,
    `${report.period.start} — ${report.period.end}`,
    '',
  ];

  // Skill inventory
  lines.push(`🧩 *Skills Inventory*: ${report.skillInventory.totalCount} installed`);

  // Cortex registry
  const reg = report.cortexRegistry;
  if (reg.entities?.length > 0) {
    lines.push(`🧠 *Cortex*: ${reg.entities.length} tracked entities, ${reg.inProgress?.length || 0} in progress, ${reg.failed?.length || 0} failed`);
  }
  lines.push('');

  // Top used (from pulse feedback, sorted by week activity)
  const topUsed = report.pulseFeedback.filter(f => f.weekTotal > 0).slice(0, 5);
  if (topUsed.length > 0) {
    lines.push('🔥 *Most Active This Week*:');
    for (const f of topUsed) {
      const scoreStr = f.weekScore !== null ? ` (${f.weekScore}% quality)` : '';
      lines.push(`  ${f.name}: ${f.weekTotal} events${scoreStr}`);
    }
    lines.push('');
  }

  // Pulse quality scores
  const withScores = report.pulseFeedback.filter(f => f.allTimeScore !== null);
  if (withScores.length > 0) {
    lines.push('📈 *Quality Scores*:');
    for (const f of withScores) {
      const arrow = f.weekDown > 0 ? '⬇️' : '✅';
      lines.push(`  ${arrow} ${f.name}: ${f.allTimeScore}% (${f.allTimeUp}↑ ${f.allTimeDown}↓)`);
    }
    lines.push('');
  }

  // Underperforming
  if (report.cortexUnderperforming.length > 0) {
    lines.push('⚠️ *Underperforming*:');
    for (const e of report.cortexUnderperforming.slice(0, 5)) {
      lines.push(`  ${e.name}: ${e.score}% quality — ${e.recentIssues.join(', ') || 'needs review'}`);
    }
    lines.push('');
  }

  // Friction summary
  if (report.friction.totalEvents > 0) {
    lines.push(`⚡ *Friction*: ${report.friction.totalEvents} events`);
    for (const [type, data] of Object.entries(report.friction.byType)) {
      const avgStr = data.avgMs > 0 ? ` (avg ${Math.round(data.avgMs / 1000)}s)` : '';
      lines.push(`  ${type}: ${data.count}${avgStr}`);
    }
    lines.push('');
  }

  // Performance
  const perf = report.pulseEvents.performance;
  if (perf.slowResponseCount > 0) {
    lines.push(`🐢 *Performance*: ${perf.slowResponseCount} slow responses`);
    lines.push(`  Avg: ${Math.round(perf.avgResponseMs / 1000)}s / Max: ${Math.round(perf.maxResponseMs / 1000)}s`);
    lines.push('');
  }

  // Regressions
  if (report.regressions.weekCount > 0) {
    lines.push(`🔁 *New Regressions*: ${report.regressions.weekCount}`);
    for (const r of report.regressions.entries.slice(0, 3)) {
      lines.push(`  [${r.category}] ${r.avoidance || r.description}`);
    }
    lines.push('');
  }

  // Gotchas
  if (report.gotchas.length > 0) {
    lines.push(`🚧 *Gotchas Discovered*: ${report.gotchas.length}`);
    for (const g of report.gotchas.slice(0, 3)) {
      lines.push(`  [${g.source}] ${g.description?.substring(0, 100)}`);
    }
    lines.push('');
  }

  // Infrastructure trends
  const metrics = report.trends.metrics || {};
  if (Object.keys(metrics).length > 0) {
    lines.push('📉 *Infrastructure Trends*:');
    for (const [key, data] of Object.entries(metrics)) {
      const arrow = data.trend === 'UP' ? '↑' : data.trend === 'DOWN' ? '↓' : '→';
      const label = key.replace(/([A-Z])/g, ' $1').replace(/Pct$/, ' %').trim();
      lines.push(`  ${label}: avg ${data.avg} (${arrow} ${data.min}-${data.max})`);
    }
    lines.push('');
  }

  // Recommendations
  if (report.recommendations.length > 0) {
    lines.push('💡 *Recommendations*:');
    for (const r of report.recommendations.slice(0, 5)) {
      const emoji = r.priority === 'high' ? '🔴' : '🟡';
      lines.push(`  ${emoji} [${r.area}] ${r.recommendation}`);
    }
  } else {
    lines.push('✅ No urgent recommendations — clean week!');
  }

  return lines.join('\n');
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

const report = generateReport();

// Save JSON report
const dateStr = new Date().toISOString().split('T')[0];
const reportFile = path.join(REVIEWS_DIR, `${dateStr}.json`);
writeFileSync(reportFile, JSON.stringify(report, null, 2));

// Output
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const summary = formatWhatsAppSummary(report);
  console.log(summary);
}

export { generateReport, formatWhatsAppSummary };
