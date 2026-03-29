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
const OUTCOMES_FILE = path.join(META_DIR, 'outcomes.json');
const PROMPT_SUGGESTIONS_FILE = path.join(META_DIR, 'prompt-suggestions.json');
const EXPERIMENTS_FILE = path.join(META_DIR, 'experiments.json');

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

// ============================================================
// LOOP 10: OUTCOME SCORING (Agent Lightning)
// ============================================================

const OUTCOMES_MAX = 500;

/**
 * Record the outcome of a prompt/response cycle.
 * @param {string} promptHash - Hash or identifier for the prompt
 * @param {object} metadata - Outcome metadata
 * @param {string[]} metadata.toolCalls - Tools invoked during the response
 * @param {boolean} metadata.userCorrected - Whether the user corrected the response
 * @param {boolean|null} metadata.taskSucceeded - Whether the task succeeded (null if unknown)
 * @param {number} metadata.retryCount - Number of retries needed
 * @param {number} metadata.responseTime - Response time in ms
 * @param {string} metadata.model - Model used for the response
 */
export async function recordOutcome(promptHash, metadata) {
  const outcomes = await readJSON(OUTCOMES_FILE, { entries: [] });

  outcomes.entries.push({
    promptHash,
    toolCalls: metadata.toolCalls || [],
    userCorrected: metadata.userCorrected || false,
    taskSucceeded: metadata.taskSucceeded ?? null,
    retryCount: metadata.retryCount || 0,
    responseTime: metadata.responseTime || 0,
    model: metadata.model || 'unknown',
    timestamp: new Date().toISOString(),
  });

  // Rotate: keep last OUTCOMES_MAX entries
  if (outcomes.entries.length > OUTCOMES_MAX) {
    outcomes.entries = outcomes.entries.slice(-OUTCOMES_MAX);
  }

  await writeJSON(OUTCOMES_FILE, outcomes);
  return outcomes.entries[outcomes.entries.length - 1];
}

/**
 * Get aggregated outcome statistics for the last N days.
 * @param {number} days - Number of days to look back (default 7)
 */
export async function getOutcomeStats(days = 7) {
  const outcomes = await readJSON(OUTCOMES_FILE, { entries: [] });
  const cutoff = Date.now() - days * 86400000;

  const recent = outcomes.entries.filter(
    e => new Date(e.timestamp).getTime() > cutoff
  );

  if (recent.length === 0) {
    return { total: 0, summary: 'No outcome data in this period.' };
  }

  const succeeded = recent.filter(e => e.taskSucceeded === true).length;
  const failed = recent.filter(e => e.taskSucceeded === false).length;
  const unknown = recent.filter(e => e.taskSucceeded === null).length;
  const corrected = recent.filter(e => e.userCorrected).length;
  const totalToolCalls = recent.reduce((sum, e) => sum + e.toolCalls.length, 0);
  const avgResponseTime = Math.round(
    recent.reduce((sum, e) => sum + e.responseTime, 0) / recent.length
  );

  // Stats by model
  const byModel = {};
  for (const entry of recent) {
    if (!byModel[entry.model]) {
      byModel[entry.model] = { total: 0, succeeded: 0, corrected: 0, totalResponseTime: 0 };
    }
    const m = byModel[entry.model];
    m.total++;
    if (entry.taskSucceeded === true) m.succeeded++;
    if (entry.userCorrected) m.corrected++;
    m.totalResponseTime += entry.responseTime;
  }

  // Compute rates per model
  for (const model of Object.keys(byModel)) {
    const m = byModel[model];
    m.successRate = m.total > 0 ? Math.round((m.succeeded / m.total) * 100) : 0;
    m.correctionRate = m.total > 0 ? Math.round((m.corrected / m.total) * 100) : 0;
    m.avgResponseTime = m.total > 0 ? Math.round(m.totalResponseTime / m.total) : 0;
  }

  return {
    total: recent.length,
    successRate: Math.round((succeeded / recent.length) * 100),
    correctionRate: Math.round((corrected / recent.length) * 100),
    succeeded,
    failed,
    unknown,
    corrected,
    avgToolCalls: Math.round((totalToolCalls / recent.length) * 100) / 100,
    avgResponseTime,
    byModel,
    summary: `${recent.length} outcomes over ${days}d: ${Math.round((succeeded / recent.length) * 100)}% success, ${Math.round((corrected / recent.length) * 100)}% corrected, avg ${Math.round((totalToolCalls / recent.length) * 100) / 100} tool calls/response`,
  };
}

// ============================================================
// LOOP 11: PROMPT OPTIMIZATION (Agent Lightning)
// ============================================================

/**
 * Analyze outcome data and generate actionable prompt optimization suggestions.
 * Identifies patterns in corrections, failures, and tool usage.
 * Stores suggestions in prompt-suggestions.json and returns them.
 */
export async function generatePromptSuggestions() {
  const outcomes = await readJSON(OUTCOMES_FILE, { entries: [] });
  const suggestions = [];

  if (outcomes.entries.length < 5) {
    const result = {
      generatedAt: new Date().toISOString(),
      entryCount: outcomes.entries.length,
      suggestions: [{ type: 'info', message: 'Not enough data yet. Need at least 5 outcomes to generate suggestions.' }],
    };
    await writeJSON(PROMPT_SUGGESTIONS_FILE, result);
    return result.suggestions;
  }

  // --- Pattern 1: Prompts with high correction rates ---
  const promptGroups = {};
  for (const entry of outcomes.entries) {
    if (!promptGroups[entry.promptHash]) {
      promptGroups[entry.promptHash] = { total: 0, corrected: 0, failed: 0, toolCalls: [] };
    }
    const g = promptGroups[entry.promptHash];
    g.total++;
    if (entry.userCorrected) g.corrected++;
    if (entry.taskSucceeded === false) g.failed++;
    g.toolCalls.push(...entry.toolCalls);
  }

  for (const [hash, stats] of Object.entries(promptGroups)) {
    if (stats.total >= 2 && stats.corrected / stats.total > 0.5) {
      suggestions.push({
        type: 'high_correction_rate',
        promptHash: hash,
        correctionRate: Math.round((stats.corrected / stats.total) * 100),
        occurrences: stats.total,
        message: `Prompt "${hash}" has a ${Math.round((stats.corrected / stats.total) * 100)}% correction rate over ${stats.total} uses. Consider rewording or adding constraints.`,
      });
    }
  }

  // --- Pattern 2: Tool call patterns that correlate with failures ---
  const toolFailures = {};
  const toolSuccesses = {};
  for (const entry of outcomes.entries) {
    for (const tool of entry.toolCalls) {
      if (entry.taskSucceeded === false) {
        toolFailures[tool] = (toolFailures[tool] || 0) + 1;
      } else if (entry.taskSucceeded === true) {
        toolSuccesses[tool] = (toolSuccesses[tool] || 0) + 1;
      }
    }
  }

  for (const [tool, failCount] of Object.entries(toolFailures)) {
    const successCount = toolSuccesses[tool] || 0;
    const total = failCount + successCount;
    if (total >= 3 && failCount / total > 0.6) {
      suggestions.push({
        type: 'tool_failure_pattern',
        tool,
        failRate: Math.round((failCount / total) * 100),
        failCount,
        successCount,
        message: `Tool "${tool}" has a ${Math.round((failCount / total) * 100)}% failure rate (${failCount}/${total}). Consider fallback strategies or pre-validation.`,
      });
    }
  }

  // --- Pattern 3: Model performance comparison ---
  const modelStats = {};
  for (const entry of outcomes.entries) {
    if (!modelStats[entry.model]) {
      modelStats[entry.model] = { total: 0, succeeded: 0, corrected: 0, totalTime: 0, taskTypes: {} };
    }
    const m = modelStats[entry.model];
    m.total++;
    if (entry.taskSucceeded === true) m.succeeded++;
    if (entry.userCorrected) m.corrected++;
    m.totalTime += entry.responseTime;

    // Group by tool usage as a proxy for task type
    const taskKey = entry.toolCalls.length === 0 ? 'chat' : entry.toolCalls.sort().join('+');
    if (!m.taskTypes[taskKey]) {
      m.taskTypes[taskKey] = { total: 0, succeeded: 0 };
    }
    m.taskTypes[taskKey].total++;
    if (entry.taskSucceeded === true) m.taskTypes[taskKey].succeeded++;
  }

  const models = Object.keys(modelStats);
  if (models.length >= 2) {
    // Find which model is better for which task types
    const allTaskTypes = new Set();
    for (const m of Object.values(modelStats)) {
      for (const t of Object.keys(m.taskTypes)) allTaskTypes.add(t);
    }

    for (const taskType of allTaskTypes) {
      let bestModel = null;
      let bestRate = -1;
      let comparison = [];

      for (const model of models) {
        const tt = modelStats[model].taskTypes[taskType];
        if (tt && tt.total >= 2) {
          const rate = tt.succeeded / tt.total;
          comparison.push({ model, rate: Math.round(rate * 100), count: tt.total });
          if (rate > bestRate) {
            bestRate = rate;
            bestModel = model;
          }
        }
      }

      if (comparison.length >= 2 && bestRate > 0) {
        const others = comparison.filter(c => c.model !== bestModel);
        const gap = comparison.find(c => c.model === bestModel).rate - Math.max(...others.map(c => c.rate));
        if (gap >= 15) {
          suggestions.push({
            type: 'model_task_affinity',
            taskType,
            bestModel,
            successRate: Math.round(bestRate * 100),
            comparison,
            message: `"${bestModel}" outperforms others by ${gap}pp for tasks using [${taskType}]. Consider routing these tasks to it.`,
          });
        }
      }
    }

    // Overall model comparison
    for (const model of models) {
      const m = modelStats[model];
      if (m.total >= 5 && m.corrected / m.total > 0.4) {
        suggestions.push({
          type: 'model_high_correction',
          model,
          correctionRate: Math.round((m.corrected / m.total) * 100),
          total: m.total,
          message: `Model "${model}" has a ${Math.round((m.corrected / m.total) * 100)}% correction rate over ${m.total} uses. Evaluate if a different model would perform better.`,
        });
      }
    }
  }

  // --- Pattern 4: High retry prompts ---
  const retryPrompts = {};
  for (const entry of outcomes.entries) {
    if (entry.retryCount > 0) {
      if (!retryPrompts[entry.promptHash]) {
        retryPrompts[entry.promptHash] = { totalRetries: 0, count: 0 };
      }
      retryPrompts[entry.promptHash].totalRetries += entry.retryCount;
      retryPrompts[entry.promptHash].count++;
    }
  }

  for (const [hash, stats] of Object.entries(retryPrompts)) {
    const avgRetries = stats.totalRetries / stats.count;
    if (stats.count >= 2 && avgRetries > 1.5) {
      suggestions.push({
        type: 'high_retry_prompt',
        promptHash: hash,
        avgRetries: Math.round(avgRetries * 10) / 10,
        occurrences: stats.count,
        message: `Prompt "${hash}" averages ${Math.round(avgRetries * 10) / 10} retries over ${stats.count} uses. Needs clearer instructions or better constraints.`,
      });
    }
  }

  const result = {
    generatedAt: new Date().toISOString(),
    entryCount: outcomes.entries.length,
    suggestions,
  };

  await writeJSON(PROMPT_SUGGESTIONS_FILE, result);
  return suggestions;
}

// ============================================================
// LOOP 12: A/B EXPERIMENT TRACKING (Agent Lightning)
// ============================================================

/**
 * Start tracking an A/B experiment.
 * @param {string} name - Unique experiment name
 * @param {object} variants - Experiment definition
 * @param {string} variants.control - Description of the control variant
 * @param {string} variants.treatment - Description of the treatment variant
 * @param {string} variants.metric - What metric is being measured
 */
export async function startExperiment(name, variants) {
  const experiments = await readJSON(EXPERIMENTS_FILE, { experiments: {} });

  if (experiments.experiments[name]) {
    return { error: `Experiment "${name}" already exists. Use a different name or end the existing one.` };
  }

  experiments.experiments[name] = {
    name,
    control: variants.control,
    treatment: variants.treatment,
    metric: variants.metric,
    startedAt: new Date().toISOString(),
    status: 'running',
    results: {
      control: [],
      treatment: [],
    },
  };

  await writeJSON(EXPERIMENTS_FILE, experiments);
  return experiments.experiments[name];
}

/**
 * Record a data point for an experiment variant.
 * @param {string} name - Experiment name
 * @param {string} variant - "control" or "treatment"
 * @param {number} score - Numeric score for this observation
 */
export async function recordExperimentOutcome(name, variant, score) {
  const experiments = await readJSON(EXPERIMENTS_FILE, { experiments: {} });

  if (!experiments.experiments[name]) {
    return { error: `Experiment "${name}" not found.` };
  }

  const exp = experiments.experiments[name];

  if (exp.status !== 'running') {
    return { error: `Experiment "${name}" is not running (status: ${exp.status}).` };
  }

  if (variant !== 'control' && variant !== 'treatment') {
    return { error: `Variant must be "control" or "treatment", got "${variant}".` };
  }

  exp.results[variant].push({
    score,
    timestamp: new Date().toISOString(),
  });

  await writeJSON(EXPERIMENTS_FILE, experiments);
  return { recorded: true, variant, score, totalSamples: exp.results[variant].length };
}

/**
 * Get experiment results with basic statistical comparison.
 * @param {string} name - Experiment name
 */
export async function getExperimentResults(name) {
  const experiments = await readJSON(EXPERIMENTS_FILE, { experiments: {} });

  if (!experiments.experiments[name]) {
    return { error: `Experiment "${name}" not found.` };
  }

  const exp = experiments.experiments[name];

  const calcStats = (dataPoints) => {
    const scores = dataPoints.map(d => d.score);
    if (scores.length === 0) return { mean: 0, count: 0, min: 0, max: 0, stdDev: 0 };

    const count = scores.length;
    const mean = scores.reduce((a, b) => a + b, 0) / count;
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / count;
    const stdDev = Math.sqrt(variance);

    return {
      mean: Math.round(mean * 1000) / 1000,
      count,
      min,
      max,
      stdDev: Math.round(stdDev * 1000) / 1000,
    };
  };

  const controlStats = calcStats(exp.results.control);
  const treatmentStats = calcStats(exp.results.treatment);

  // Determine winner
  let winner = 'insufficient_data';
  let difference = 0;
  let relativeDifference = 0;

  if (controlStats.count >= 3 && treatmentStats.count >= 3) {
    difference = Math.round((treatmentStats.mean - controlStats.mean) * 1000) / 1000;
    relativeDifference = controlStats.mean !== 0
      ? Math.round(((treatmentStats.mean - controlStats.mean) / Math.abs(controlStats.mean)) * 10000) / 100
      : 0;

    if (treatmentStats.mean > controlStats.mean) {
      winner = 'treatment';
    } else if (controlStats.mean > treatmentStats.mean) {
      winner = 'control';
    } else {
      winner = 'tie';
    }
  }

  return {
    name: exp.name,
    metric: exp.metric,
    status: exp.status,
    startedAt: exp.startedAt,
    control: { description: exp.control, ...controlStats },
    treatment: { description: exp.treatment, ...treatmentStats },
    winner,
    difference,
    relativeDifference: `${relativeDifference}%`,
    summary: winner === 'insufficient_data'
      ? `Need at least 3 samples per variant (control: ${controlStats.count}, treatment: ${treatmentStats.count}).`
      : `${winner === 'tie' ? 'Tie' : winner.charAt(0).toUpperCase() + winner.slice(1) + ' wins'}: ${exp.metric} is ${difference > 0 ? '+' : ''}${difference} (${relativeDifference}%) for treatment vs control.`,
  };
}
