/**
 * Practice Engine — Deliberate skill building through attempt + feedback
 *
 * Overlord picks tasks, attempts them in the sandbox or on test branches,
 * self-grades, submits for Gil's rating, and records what it learned.
 *
 * Practice types:
 *   1. FRONTEND — Build a UI component, screenshot, self-evaluate
 *   2. DESIGN — Study a competitor site, attempt to replicate a pattern
 *   3. CODE — Write a function/module, test it, evaluate quality
 *   4. BUSINESS — Analyze a project, make a recommendation, track if it was right
 *
 * Runs during idle study sessions (idle-study.js mode 3: skill_practice)
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { recordDecision } from './decision-journal.js';

const PRACTICE_LOG = '/app/data/practice-log.json';
const PRACTICE_HISTORY = '/app/data/practice-log.jsonl';

// Also write to sandbox dashboard
const SANDBOX_PATH = '/root/projects/Sandbox/data/practice-log.json';

// Task templates for practice
const PRACTICE_TASKS = [
  {
    type: 'frontend',
    tasks: [
      'Build a responsive card component with image, title, price, and CTA button',
      'Build a hero section with background image, overlay text, and call-to-action',
      'Build a pricing table with 3 tiers and a highlighted recommended option',
      'Build a testimonial carousel with avatar, quote, and name',
      'Build a footer with newsletter signup, social links, and sitemap',
      'Build a mobile navigation menu with hamburger toggle',
      'Build a search bar with autocomplete dropdown',
      'Build a data table with sort and filter controls',
    ],
  },
  {
    type: 'design',
    tasks: [
      'Study a boat marketplace listing page and identify 3 UX patterns to replicate',
      'Study a fitness app onboarding flow and identify what makes it effective',
      'Study a SaaS pricing page and analyze the conversion psychology',
      'Study a meditation app UI and identify the design language that creates calm',
    ],
  },
  {
    type: 'code',
    tasks: [
      'Write a rate limiter middleware with sliding window algorithm',
      'Write a retry function with exponential backoff and jitter',
      'Write a simple pub/sub event system',
      'Write a function that generates a sitemap.xml from a list of routes',
      'Write a caching layer with TTL and LRU eviction',
    ],
  },
  {
    type: 'business',
    tasks: [
      'Analyze OnlyHulls competitor landscape and recommend one differentiation move',
      'Write a cold outreach template for recruiting boat sellers to a marketplace',
      'Design an onboarding flow for a first-time user of a coaching website',
      'Propose a monetization strategy for a free surfing information site',
    ],
  },
];

/**
 * Pick a random practice task
 */
export function pickTask(preferredType = null) {
  const pool = preferredType
    ? PRACTICE_TASKS.filter(p => p.type === preferredType)
    : PRACTICE_TASKS;

  if (pool.length === 0) return null;

  const category = pool[Math.floor(Math.random() * pool.length)];
  const task = category.tasks[Math.floor(Math.random() * category.tasks.length)];

  return { type: category.type, task };
}

/**
 * Record a practice attempt
 */
export function recordAttempt(attempt) {
  let log = loadLog();

  const entry = {
    id: log.length + 1,
    type: attempt.type || 'unknown',
    task: (attempt.task || '').substring(0, 300),
    attempt: (attempt.attempt || '').substring(0, 1000), // what was built/written
    selfAssessment: (attempt.selfAssessment || '').substring(0, 300),
    selfGrade: attempt.selfGrade || null, // 1-5
    gilRating: null, // filled by Gil later
    outcome: attempt.outcome || 'pending', // 'success', 'failure', 'partial', 'pending'
    lesson: (attempt.lesson || '').substring(0, 200),
    timestamp: new Date().toISOString(),
    sandboxPath: attempt.sandboxPath || null,
  };

  log.push(entry);
  if (log.length > 200) log = log.slice(-200);
  saveLog(log);
  appendFileSync(PRACTICE_HISTORY, JSON.stringify(entry) + '\n');

  // Also record as a decision for calibration
  if (attempt.type === 'business') {
    recordDecision({
      recommendation: entry.task,
      evidence: entry.selfAssessment,
      project: attempt.project,
      source: 'practice',
      confidence: entry.selfGrade >= 4 ? 'high' : entry.selfGrade >= 3 ? 'medium' : 'low',
    });
  }

  return entry;
}

/**
 * Rate a practice attempt (Gil provides rating 1-5)
 */
export function rateAttempt(attemptId, rating, feedback = '') {
  const log = loadLog();
  const entry = log.find(e => e.id === attemptId);
  if (!entry) return null;

  entry.gilRating = rating;
  entry.outcome = rating >= 4 ? 'success' : rating >= 3 ? 'partial' : 'failure';
  if (feedback) entry.gilFeedback = feedback.substring(0, 200);
  entry.ratedAt = new Date().toISOString();

  saveLog(log);
  return entry;
}

/**
 * Get practice stats
 */
export function getPracticeStats() {
  const log = loadLog();
  const rated = log.filter(e => e.gilRating !== null);

  if (rated.length === 0) return { total: log.length, rated: 0, message: 'No rated attempts yet' };

  const avgGilRating = rated.reduce((s, e) => s + e.gilRating, 0) / rated.length;
  const avgSelfGrade = rated.filter(e => e.selfGrade).reduce((s, e) => s + e.selfGrade, 0) / rated.filter(e => e.selfGrade).length || 0;

  // By type
  const byType = {};
  for (const e of rated) {
    if (!byType[e.type]) byType[e.type] = { count: 0, avgRating: 0, total: 0 };
    byType[e.type].count++;
    byType[e.type].total += e.gilRating;
    byType[e.type].avgRating = byType[e.type].total / byType[e.type].count;
  }

  return {
    total: log.length,
    rated: rated.length,
    avgGilRating: Math.round(avgGilRating * 10) / 10,
    avgSelfGrade: Math.round(avgSelfGrade * 10) / 10,
    calibrationGap: Math.round(Math.abs(avgSelfGrade - avgGilRating) * 10) / 10,
    byType,
    weakestArea: Object.entries(byType).sort((a, b) => a[1].avgRating - b[1].avgRating)[0]?.[0] || null,
    strongestArea: Object.entries(byType).sort((a, b) => b[1].avgRating - a[1].avgRating)[0]?.[0] || null,
  };
}

/**
 * Get context for prompt injection
 */
export function getPracticeContext() {
  const stats = getPracticeStats();
  if (stats.rated < 3) return '';
  return `PRACTICE: ${stats.total} attempts, ${stats.rated} rated. Gil avg: ${stats.avgGilRating}/5. Weakest: ${stats.weakestArea}. Strongest: ${stats.strongestArea}. Self-calibration gap: ${stats.calibrationGap}`;
}

function loadLog() {
  try { return JSON.parse(readFileSync(PRACTICE_LOG, 'utf8')); }
  catch { return []; }
}

function saveLog(log) {
  writeFileSync(PRACTICE_LOG, JSON.stringify(log, null, 2));
  try { writeFileSync(SANDBOX_PATH, JSON.stringify(log, null, 2)); } catch { /* ok */ }
}
