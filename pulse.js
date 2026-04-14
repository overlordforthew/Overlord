/**
 * Pulse — Overlord's health & quality tracker
 *
 * Track, annotate, and monitor the health of anything:
 * skills, tools, services, containers, deployments — whatever.
 *
 * Four core capabilities:
 * 1. Registry — track any entity with type, status, source
 * 2. Annotations — persistent notes attached to any tracked entity
 * 3. Quality tracking — up/down ratings with labels, health scores
 * 4. Gap detection — spots missing capabilities from error/response text
 *
 * Use it everywhere:
 * - After skill execution → pulse.record('scrape', 'up', 'completed successfully')
 * - After deploy → pulse.record('namibarden', 'up', 'deployed v2.3')
 * - After failure → pulse.record('dns', 'down', ['broken-script'], 'cloudflare timeout')
 * - Quick check → pulse.check('scrape') → health summary
 * - Dashboard → pulse.dashboard() → full system health
 *
 * Originally extracted from Context Hub (andrewyng/context-hub) patterns.
 * Evolved: skill-learner.js → cortex.js → pulse.js
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import pino from 'pino';

const logger = pino({ level: 'info' });

const DATA_DIR = '/app/data/pulse';
const REGISTRY_FILE = join(DATA_DIR, 'registry.json');
const ANNOTATIONS_DIR = join(DATA_DIR, 'annotations');
const FEEDBACK_FILE = join(DATA_DIR, 'feedback.json');
const EVENTS_FILE = join(DATA_DIR, 'events.json');

// Legacy paths — for migration (cortex → pulse)
const LEGACY_CORTEX_DIR = '/app/data/cortex';
const LEGACY_CORTEX_REGISTRY = join(LEGACY_CORTEX_DIR, 'registry.json');
const LEGACY_CORTEX_ANNOTATIONS = join(LEGACY_CORTEX_DIR, 'annotations');
const LEGACY_CORTEX_FEEDBACK = join(LEGACY_CORTEX_DIR, 'feedback.json');

// Even older legacy paths (skill-learner → cortex)
const LEGACY_SKILLS_FILE = '/app/data/acquired-skills.json';
const LEGACY_ANNOTATIONS_DIR = '/app/data/skill-annotations';
const LEGACY_FEEDBACK_FILE = '/app/data/skill-feedback.json';

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(ANNOTATIONS_DIR, { recursive: true });
}

// Migrate from cortex or legacy formats
function migrateLegacy() {
  ensureDataDir();

  // Migrate registry: cortex → pulse, or skill-learner → pulse
  try {
    if (!existsSync(REGISTRY_FILE)) {
      if (existsSync(LEGACY_CORTEX_REGISTRY)) {
        const data = readFileSync(LEGACY_CORTEX_REGISTRY, 'utf8');
        writeFileSync(REGISTRY_FILE, data);
        logger.info('Pulse: migrated registry from cortex');
      } else if (existsSync(LEGACY_SKILLS_FILE)) {
        const old = JSON.parse(readFileSync(LEGACY_SKILLS_FILE, 'utf8'));
        const registry = {
          entities: old.acquired.map(s => ({ ...s, type: 'skill', status: 'active' })),
          inProgress: old.inProgress.map(s => ({ ...s, type: 'skill' })),
          failed: old.failed.map(s => ({ ...s, type: 'skill' })),
        };
        writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
        logger.info('Pulse: migrated registry from skill-learner');
      }
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Pulse: registry migration skipped');
  }

  // Migrate feedback
  try {
    if (!existsSync(FEEDBACK_FILE)) {
      const src = existsSync(LEGACY_CORTEX_FEEDBACK) ? LEGACY_CORTEX_FEEDBACK
        : existsSync(LEGACY_FEEDBACK_FILE) ? LEGACY_FEEDBACK_FILE : null;
      if (src) {
        writeFileSync(FEEDBACK_FILE, readFileSync(src, 'utf8'));
        logger.info({ from: src }, 'Pulse: migrated feedback');
      }
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Pulse: feedback migration skipped');
  }

  // Migrate annotations
  try {
    const srcDir = existsSync(LEGACY_CORTEX_ANNOTATIONS) ? LEGACY_CORTEX_ANNOTATIONS
      : existsSync(LEGACY_ANNOTATIONS_DIR) ? LEGACY_ANNOTATIONS_DIR : null;
    if (srcDir) {
      const files = readdirSync(srcDir).filter(f => f.endsWith('.json'));
      let migrated = 0;
      for (const f of files) {
        const dest = join(ANNOTATIONS_DIR, f);
        if (!existsSync(dest)) {
          writeFileSync(dest, readFileSync(join(srcDir, f), 'utf8'));
          migrated++;
        }
      }
      if (migrated > 0) logger.info({ count: migrated }, 'Pulse: migrated annotations');
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Pulse: annotation migration skipped');
  }
}

// Run migration on first load
migrateLegacy();

// ============================================================
// GAP DETECTION
// ============================================================

const GAP_PATTERNS = [
  { pattern: /don't have (?:access to|a tool for|the ability to|a way to)\s+(.+)/i, extract: 1 },
  { pattern: /no (?:tool|command|API|integration) (?:for|to)\s+(.+)/i, extract: 1 },
  { pattern: /can't (?:currently|yet)\s+(.+)/i, extract: 1 },
  { pattern: /not (?:currently|yet) (?:able to|capable of)\s+(.+)/i, extract: 1 },
  { pattern: /would need (?:a|an|to install|to set up)\s+(.+?)(?:\s+to\b|\s+for\b|\.)/i, extract: 1 },
  { pattern: /missing (?:dependency|tool|integration|module):\s*(.+)/i, extract: 1 },
];

export function detectCapabilityGap(responseText) {
  if (!responseText) return null;
  for (const { pattern, extract } of GAP_PATTERNS) {
    const match = responseText.match(pattern);
    if (match) {
      return {
        gap: match[extract].trim().substring(0, 200),
        fullContext: responseText.substring(0, 500),
      };
    }
  }
  return null;
}

// ============================================================
// REGISTRY — tracks any entity (skill, tool, service, container, deployment)
// ============================================================

const ENTITY_TYPES = ['skill', 'tool', 'service', 'script', 'integration', 'container', 'deployment'];

function loadRegistry() {
  try {
    return JSON.parse(readFileSync(REGISTRY_FILE, 'utf-8'));
  } catch {
    return { entities: [], inProgress: [], failed: [] };
  }
}

function saveRegistry(registry) {
  ensureDataDir();
  writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

export function loadSkills() {
  const reg = loadRegistry();
  return {
    acquired: reg.entities.filter(e => e.status === 'active'),
    inProgress: reg.inProgress,
    failed: reg.failed,
  };
}

export function register(name, description, type = 'skill', source = 'auto') {
  const registry = loadRegistry();
  if (registry.entities.find(e => e.name.toLowerCase() === name.toLowerCase() && e.type === type)) return false;

  registry.entities.push({
    name,
    description,
    type: ENTITY_TYPES.includes(type) ? type : 'skill',
    source,
    status: 'active',
    acquiredAt: new Date().toISOString(),
  });
  registry.inProgress = registry.inProgress.filter(e => e.name.toLowerCase() !== name.toLowerCase());
  saveRegistry(registry);
  logger.info({ name, type, source }, 'Pulse: registered');
  return true;
}

export function registerSkill(name, description, source = 'auto') {
  return register(name, description, 'skill', source);
}

export function markInProgress(name, gap, type = 'skill') {
  const registry = loadRegistry();
  if (registry.inProgress.find(e => e.name === name)) return;
  if (registry.entities.find(e => e.name.toLowerCase() === name.toLowerCase())) return;
  registry.inProgress.push({ name, gap, type, startedAt: new Date().toISOString() });
  saveRegistry(registry);
}

export function markSkillInProgress(name, gap) {
  return markInProgress(name, gap, 'skill');
}

export function markFailed(name, reason, type = 'skill') {
  const registry = loadRegistry();
  registry.inProgress = registry.inProgress.filter(e => e.name !== name);
  registry.failed.push({ name, reason, type, failedAt: new Date().toISOString() });
  if (registry.failed.length > 20) registry.failed = registry.failed.slice(-20);
  saveRegistry(registry);
}

export function markSkillFailed(name, reason) {
  return markFailed(name, reason, 'skill');
}

export function buildSkillAcquisitionPrompt(gap) {
  return `You detected a capability gap: "${gap.gap}"

Context: ${gap.fullContext}

Your task:
1. Research how to add this capability to the Overlord bot
2. If it requires installing a tool/package, do it
3. If it requires writing a script, create it in /app/scripts/
4. Test that the new capability works
5. Document what you did

CONSTRAINTS:
- Only install well-known, trusted packages
- Don't modify core bot files (index.js, router.js, etc.) — create new scripts/modules
- Test in a non-destructive way
- If this requires external API keys we don't have, report that as the blocker

End with: "SKILL ACQUIRED: <name> — <one-line description>" if successful,
or "SKILL BLOCKED: <reason>" if you can't add it.`;
}

// ============================================================
// ANNOTATIONS — persistent notes on any tracked entity
// ============================================================

function annotationPath(name) {
  const safe = name.replace(/\//g, '--').replace(/\s+/g, '-').toLowerCase();
  return join(ANNOTATIONS_DIR, `${safe}.json`);
}

export function readAnnotation(name) {
  try {
    return JSON.parse(readFileSync(annotationPath(name), 'utf8'));
  } catch {
    return null;
  }
}

export function writeAnnotation(name, note, type = 'skill') {
  ensureDataDir();
  const existing = readAnnotation(name);
  const data = {
    entity: name,
    type,
    note,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updateCount: (existing?.updateCount || 0) + 1,
  };
  writeFileSync(annotationPath(name), JSON.stringify(data, null, 2));
  logger.info({ entity: name, type }, 'Pulse: annotation saved');
  return data;
}

export function clearAnnotation(name) {
  try {
    unlinkSync(annotationPath(name));
    return true;
  } catch {
    return false;
  }
}

export function listAnnotations() {
  try {
    const files = readdirSync(ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        return JSON.parse(readFileSync(join(ANNOTATIONS_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ============================================================
// FEEDBACK / QUALITY TRACKING
// ============================================================

const VALID_LABELS = [
  'accurate', 'well-structured', 'helpful', 'good-examples',
  'outdated', 'inaccurate', 'incomplete', 'wrong-examples',
  'broken-script', 'missing-dependency', 'needs-update',
];

function loadFeedback() {
  try {
    return JSON.parse(readFileSync(FEEDBACK_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveFeedback(data) {
  ensureDataDir();
  writeFileSync(FEEDBACK_FILE, JSON.stringify(data, null, 2));
}

export function rate(name, rating, labels = [], comment = '') {
  if (rating !== 'up' && rating !== 'down') return null;
  const validLabels = labels.filter(l => VALID_LABELS.includes(l));

  const feedback = loadFeedback();
  if (!feedback[name]) {
    feedback[name] = { up: 0, down: 0, entries: [] };
  }

  feedback[name][rating]++;
  feedback[name].entries.push({
    rating,
    labels: validLabels,
    comment: comment.substring(0, 300),
    at: new Date().toISOString(),
  });

  if (feedback[name].entries.length > 50) {
    feedback[name].entries = feedback[name].entries.slice(-50);
  }

  saveFeedback(feedback);
  logger.info({ entity: name, rating, labels: validLabels }, 'Pulse: feedback recorded');
  return feedback[name];
}

export function feedbackSkill(skillName, rating, labels = [], comment = '') {
  return rate(skillName, rating, labels, comment);
}

export function getFeedbackSummary(name) {
  const feedback = loadFeedback();
  const data = feedback[name];
  if (!data) return null;

  const recent = data.entries.slice(-10);
  const recentDown = recent.filter(e => e.rating === 'down');
  const topLabels = {};
  for (const e of recentDown) {
    for (const l of e.labels) {
      topLabels[l] = (topLabels[l] || 0) + 1;
    }
  }

  return {
    upCount: data.up,
    downCount: data.down,
    score: data.up + data.down > 0 ? Math.round((data.up / (data.up + data.down)) * 100) : null,
    recentIssues: Object.entries(topLabels).sort((a, b) => b[1] - a[1]).map(([l]) => l),
    lastFeedback: data.entries[data.entries.length - 1]?.at || null,
  };
}

export function getSkillFeedbackSummary(skillName) {
  return getFeedbackSummary(skillName);
}

// ============================================================
// HEALTH — surfaces what needs attention
// ============================================================

export function getEntitiesNeedingAttention() {
  const feedback = loadFeedback();
  const annotations = listAnnotations();
  const needsAttention = [];

  for (const [name, data] of Object.entries(feedback)) {
    const total = data.up + data.down;
    if (total < 2) continue;
    const score = data.up / total;
    if (score < 0.6) {
      const recent = data.entries.slice(-5);
      const labels = recent.flatMap(e => e.labels);
      needsAttention.push({
        name,
        reason: `${Math.round(score * 100)}% positive (${data.down} issues: ${[...new Set(labels)].join(', ') || 'unspecified'})`,
        score,
        priority: 1,
      });
    }
  }

  for (const a of annotations) {
    const issueWords = ['broken', 'fails', 'outdated', 'fix', 'bug', 'wrong', 'error'];
    const hasIssue = issueWords.some(w => a.note.toLowerCase().includes(w));
    if (hasIssue && !needsAttention.find(n => n.name === (a.entity || a.skill))) {
      needsAttention.push({
        name: a.entity || a.skill,
        reason: `Annotated: ${a.note.substring(0, 80)}`,
        score: 0.5,
        priority: 2,
      });
    }
  }

  return needsAttention.sort((a, b) => a.priority - b.priority || a.score - b.score);
}

export function getSkillsNeedingAttention() {
  return getEntitiesNeedingAttention();
}

// ============================================================
// EVENT LOG — lightweight record of what happened and when
// ============================================================

function loadEvents() {
  try {
    return JSON.parse(readFileSync(EVENTS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveEvents(events) {
  ensureDataDir();
  writeFileSync(EVENTS_FILE, JSON.stringify(events, null, 2));
}

/**
 * Record an event — the main way other modules interact with Pulse.
 *
 * Usage:
 *   record('scrape', 'up')                          — scrape worked
 *   record('deploy:namibarden', 'up', 'v2.3 live')  — deploy succeeded
 *   record('dns', 'down', 'cloudflare timeout')     — dns failed
 *   record('scrape', 'down', 'timeout after 30s', ['broken-script'])
 *
 * This simultaneously:
 * - Logs the event for history
 * - Auto-rates the entity (up/down) in the feedback system
 * - Auto-registers the entity if not already tracked
 */
export function record(name, outcome = 'up', comment = '', labels = []) {
  // Log the event
  const events = loadEvents();
  events.push({
    name,
    outcome,
    comment: typeof comment === 'string' ? comment.substring(0, 300) : '',
    at: new Date().toISOString(),
  });
  // Keep last 200 events
  if (events.length > 200) events.splice(0, events.length - 200);
  saveEvents(events);

  // Auto-rate
  const rating = outcome === 'down' || outcome === 'fail' || outcome === 'error' ? 'down' : 'up';
  const feedbackLabels = Array.isArray(labels) ? labels : [];
  rate(name, rating, feedbackLabels, typeof comment === 'string' ? comment : '');

  logger.info({ name, outcome }, 'Pulse: event recorded');
  return { name, outcome, rating };
}

/**
 * Quick health check for a single entity.
 * Returns a plain-text summary suitable for WhatsApp or logs.
 */
export function check(name) {
  const feedback = getFeedbackSummary(name);
  const annotation = readAnnotation(name);
  const events = loadEvents().filter(e => e.name === name).slice(-5);

  if (!feedback && !annotation && events.length === 0) {
    return `${name}: no data tracked yet`;
  }

  const parts = [`*${name}*`];

  if (feedback) {
    const emoji = feedback.score >= 80 ? '🟢' : feedback.score >= 50 ? '🟡' : '🔴';
    parts.push(`${emoji} Health: ${feedback.score}% (${feedback.upCount}↑ ${feedback.downCount}↓)`);
    if (feedback.recentIssues.length > 0) {
      parts.push(`Issues: ${feedback.recentIssues.join(', ')}`);
    }
  }

  if (annotation) {
    parts.push(`📝 Note: ${annotation.note.substring(0, 100)}`);
  }

  if (events.length > 0) {
    const last = events[events.length - 1];
    const ago = Math.round((Date.now() - new Date(last.at).getTime()) / 60000);
    const timeStr = ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago / 60)}h ago` : `${Math.round(ago / 1440)}d ago`;
    parts.push(`Last: ${last.outcome} ${timeStr}${last.comment ? ` — ${last.comment.substring(0, 60)}` : ''}`);
  }

  return parts.join('\n');
}

/**
 * Get recent events for an entity or all entities.
 */
export function recentEvents(name = null, limit = 10) {
  let events = loadEvents();
  if (name) events = events.filter(e => e.name === name);
  return events.slice(-limit);
}

// ============================================================
// DASHBOARD — full system health view
// ============================================================

export function dashboard() {
  const registry = loadRegistry();
  const entities = registry.entities;
  const events = loadEvents();
  const lines = ['📊 *Pulse Dashboard*\n'];

  // Recent activity
  const last24h = events.filter(e => Date.now() - new Date(e.at).getTime() < 86400000);
  const upCount = last24h.filter(e => e.outcome === 'up').length;
  const downCount = last24h.filter(e => e.outcome !== 'up').length;
  lines.push(`*Last 24h:* ${last24h.length} events (${upCount}✓ ${downCount}✗)\n`);

  // Entities by type
  if (entities.length > 0) {
    const byType = {};
    for (const e of entities) {
      const t = e.type || 'skill';
      if (!byType[t]) byType[t] = [];
      byType[t].push(e);
    }

    for (const [type, items] of Object.entries(byType)) {
      lines.push(`*${type.charAt(0).toUpperCase() + type.slice(1)}s (${items.length}):*`);
      for (const e of items) {
        const feedback = getFeedbackSummary(e.name);
        const annotation = readAnnotation(e.name);
        let status = '✅';
        if (feedback && feedback.score !== null && feedback.score < 60) status = '🔴';
        else if (feedback && feedback.score !== null && feedback.score < 80) status = '🟡';
        let suffix = '';
        if (annotation) suffix += ' 📝';
        if (feedback && feedback.downCount > 0) suffix += ` (${feedback.downCount}↓)`;
        lines.push(`  ${status} ${e.name} — ${e.description || '(no description)'}${suffix}`);
      }
    }
  } else {
    lines.push('No entities tracked yet.');
  }

  // In progress
  if (registry.inProgress.length > 0) {
    lines.push(`\n*In Progress (${registry.inProgress.length}):*`);
    for (const e of registry.inProgress) {
      lines.push(`  🔄 ${e.name} — ${e.gap}`);
    }
  }

  // Needs attention
  const needsAttention = getEntitiesNeedingAttention();
  if (needsAttention.length > 0) {
    lines.push(`\n*Needs Attention (${needsAttention.length}):*`);
    for (const e of needsAttention.slice(0, 5)) {
      lines.push(`  🔧 ${e.name} — ${e.reason}`);
    }
  }

  // Recent failures
  const recentFails = last24h.filter(e => e.outcome !== 'up').slice(-5);
  if (recentFails.length > 0) {
    lines.push('\n*Recent Failures:*');
    for (const e of recentFails) {
      const ago = Math.round((Date.now() - new Date(e.at).getTime()) / 60000);
      const timeStr = ago < 60 ? `${ago}m ago` : `${Math.round(ago / 60)}h ago`;
      lines.push(`  ✗ ${e.name} ${timeStr}${e.comment ? ` — ${e.comment.substring(0, 60)}` : ''}`);
    }
  }

  return lines.join('\n');
}

// Backward-compatible aliases for cortex imports
export function formatRegistry(filterType = null) {
  return dashboard();
}

export function formatSkillsList() {
  return dashboard();
}

// ============================================================
// CAPABILITY GAP TRACKER
// ============================================================

const GAPS_PATH = join(DATA_DIR, 'capability-gaps.json');

/**
 * Record a capability gap — something Overlord couldn't do or got corrected on.
 *
 * @param {string} category - 'tool' | 'knowledge' | 'integration' | 'skill' | 'performance'
 * @param {string} description - What the gap is
 * @param {string} context - What triggered the gap (task title, error, user correction)
 */
export function recordGap(category, description, context = '') {
  let gaps = [];
  try { gaps = JSON.parse(readFileSync(GAPS_PATH, 'utf8')); } catch { /* fresh */ }

  // Deduplicate by fuzzy match on description
  const descLower = description.toLowerCase();
  const existing = gaps.find(g => g.description.toLowerCase() === descLower);

  if (existing) {
    existing.count += 1;
    existing.lastSeen = new Date().toISOString();
    if (context) existing.lastContext = context.substring(0, 200);
  } else {
    gaps.push({
      category,
      description: description.substring(0, 200),
      context: context.substring(0, 200),
      lastContext: context.substring(0, 200),
      count: 1,
      firstSeen: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      resolved: false,
    });
  }

  // Cap at 100 entries
  if (gaps.length > 100) {
    gaps.sort((a, b) => b.count - a.count);
    gaps = gaps.slice(0, 100);
  }

  writeFileSync(GAPS_PATH, JSON.stringify(gaps, null, 2));
  return gaps.find(g => g.description.toLowerCase() === descLower);
}

/**
 * Get unresolved gaps sorted by frequency.
 */
export function getGapReport(limit = 10) {
  try {
    const gaps = JSON.parse(readFileSync(GAPS_PATH, 'utf8'));
    return gaps
      .filter(g => !g.resolved)
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export { VALID_LABELS, ENTITY_TYPES };
