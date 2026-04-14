/**
 * Pattern Miner — Cross-project learning reuse
 *
 * Stores outcomes from launches, offers, onboarding flows, pricing tests,
 * and outreach sequences. When working on Project B, queries:
 * "What worked in Project A that's similar?"
 *
 * Also enforces roadmap discipline: every task must have
 * expected metric impact, confidence, and time-to-learn.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const PATTERNS_PATH = '/app/data/cross-project-patterns.json';

/**
 * Record a pattern (what worked/failed across projects)
 */
export function recordPattern(pattern) {
  let patterns = loadPatterns();

  patterns.push({
    id: patterns.length + 1,
    type: pattern.type || 'general', // 'ux', 'onboarding', 'pricing', 'outreach', 'deploy', 'fix'
    description: (pattern.description || '').substring(0, 300),
    projectSource: pattern.projectSource || null,
    outcome: pattern.outcome || 'unknown', // 'success', 'failure', 'neutral'
    metric: pattern.metric || null,
    metricDelta: pattern.metricDelta || null,
    confidence: pattern.confidence || 'medium',
    createdAt: new Date().toISOString(),
    appliedTo: [], // track which projects reused this
  });

  // Cap at 200
  if (patterns.length > 200) patterns = patterns.slice(-200);
  savePatterns(patterns);
  return patterns[patterns.length - 1];
}

/**
 * Find patterns relevant to a project/task
 */
export function findRelevantPatterns(query, project = null) {
  const patterns = loadPatterns();
  const queryLower = query.toLowerCase();
  const words = queryLower.split(/\s+/);

  return patterns
    .filter(p => p.outcome === 'success') // only successful patterns
    .map(p => {
      const text = `${p.description} ${p.type} ${p.projectSource || ''}`.toLowerCase();
      const matchScore = words.filter(w => text.includes(w)).length / words.length;
      return { ...p, relevance: matchScore };
    })
    .filter(p => p.relevance > 0.2)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 5);
}

/**
 * Validate a proposed task against roadmap discipline
 * Returns { valid, missing } — missing fields that are required
 */
export function validateTaskProposal(task) {
  const required = ['expectedMetricImpact', 'confidence', 'timeToLearn'];
  const missing = required.filter(field => !task[field]);

  return {
    valid: missing.length === 0,
    missing,
    message: missing.length > 0
      ? `Task missing: ${missing.join(', ')}. Every task needs expected metric impact, confidence level, and time-to-learn.`
      : 'Task proposal meets roadmap discipline requirements.',
  };
}

/**
 * Get pattern context for prompt injection
 */
export function getPatternContext(project) {
  const patterns = loadPatterns()
    .filter(p => p.outcome === 'success')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 5);

  if (patterns.length === 0) return '';

  const lines = patterns.map(p =>
    `[${p.projectSource}→${p.type}] ${p.description.substring(0, 80)} (${p.outcome})`
  );
  return `WINNING PATTERNS: ${lines.join('; ')}`;
}

function loadPatterns() {
  try { return JSON.parse(readFileSync(PATTERNS_PATH, 'utf8')); }
  catch { return []; }
}

function savePatterns(patterns) {
  writeFileSync(PATTERNS_PATH, JSON.stringify(patterns, null, 2));
}
