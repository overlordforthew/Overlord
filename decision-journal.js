/**
 * Decision Journal — Track every recommendation Overlord makes
 *
 * Records: what was recommended, evidence used, what happened, was it right?
 * After 30+ decisions, patterns emerge: overconfidence, blind spots, strengths.
 *
 * "A co-founder who doesn't track outcomes is just guessing confidently."
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';

const JOURNAL_PATH = '/app/data/decision-journal.json';
const JOURNAL_LOG = '/app/data/decision-journal.jsonl';

// Also write to sandbox for the dashboard
const SANDBOX_PATH = '/root/projects/Sandbox/data/decision-journal.json';

/**
 * Record a decision/recommendation
 */
export function recordDecision(decision) {
  let journal = loadJournal();

  const entry = {
    id: journal.length + 1,
    recommendation: (decision.recommendation || '').substring(0, 300),
    evidence: (decision.evidence || '').substring(0, 300),
    project: decision.project || null,
    source: decision.source || 'unknown', // 'scorecard', 'patrol', 'proposal', 'experiment', 'conversation'
    confidence: decision.confidence || 'medium', // 'low', 'medium', 'high'
    timestamp: new Date().toISOString(),
    actualOutcome: null, // filled in later
    wasRight: null, // filled in later
    lesson: null, // filled in later
  };

  journal.push(entry);
  if (journal.length > 500) journal = journal.slice(-500);
  saveJournal(journal);
  appendFileSync(JOURNAL_LOG, JSON.stringify(entry) + '\n');

  return entry;
}

/**
 * Record the outcome of a past decision
 */
export function recordOutcome(decisionId, outcome, wasRight, lesson = null) {
  const journal = loadJournal();
  const entry = journal.find(d => d.id === decisionId);
  if (!entry) return null;

  entry.actualOutcome = (outcome || '').substring(0, 300);
  entry.wasRight = wasRight;
  entry.lesson = lesson ? lesson.substring(0, 200) : null;
  entry.resolvedAt = new Date().toISOString();

  saveJournal(journal);
  return entry;
}

/**
 * Get self-calibration stats
 */
export function getCalibrationStats() {
  const journal = loadJournal().filter(d => d.wasRight !== null);
  if (journal.length < 5) return { total: journal.length, message: 'Not enough decisions to calibrate' };

  const total = journal.length;
  const right = journal.filter(d => d.wasRight === true).length;
  const wrong = journal.filter(d => d.wasRight === false).length;
  const accuracy = Math.round((right / total) * 100);

  // Calibration by confidence level
  const byConfidence = {};
  for (const level of ['low', 'medium', 'high']) {
    const subset = journal.filter(d => d.confidence === level);
    if (subset.length > 0) {
      const subRight = subset.filter(d => d.wasRight === true).length;
      byConfidence[level] = {
        total: subset.length,
        accuracy: Math.round((subRight / subset.length) * 100),
      };
    }
  }

  // By source
  const bySource = {};
  for (const d of journal) {
    const s = d.source || 'unknown';
    if (!bySource[s]) bySource[s] = { total: 0, right: 0 };
    bySource[s].total++;
    if (d.wasRight) bySource[s].right++;
  }

  // Top lessons
  const lessons = journal.filter(d => d.lesson).map(d => d.lesson).slice(-5);

  return {
    total,
    right,
    wrong,
    accuracy,
    byConfidence,
    bySource,
    lessons,
    message: accuracy >= 70 ? 'Decisions are solid' : accuracy >= 50 ? 'Room for improvement' : 'Significant calibration needed',
  };
}

/**
 * Get context for prompt injection
 */
export function getDecisionContext() {
  const stats = getCalibrationStats();
  if (stats.total < 5) return '';

  const lines = [`DECISION CALIBRATION: ${stats.accuracy}% accuracy (${stats.total} tracked)`];
  if (stats.byConfidence.high) {
    lines.push(`  High confidence: ${stats.byConfidence.high.accuracy}% accurate`);
  }
  if (stats.lessons.length > 0) {
    lines.push(`  Recent lesson: ${stats.lessons[stats.lessons.length - 1]}`);
  }
  return lines.join('\n');
}

function loadJournal() {
  try { return JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')); }
  catch { return []; }
}

function saveJournal(journal) {
  writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, 2));
  // Mirror to sandbox dashboard
  try { writeFileSync(SANDBOX_PATH, JSON.stringify(journal, null, 2)); } catch { /* sandbox may not exist */ }
}
