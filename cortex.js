/**
 * Cortex — Overlord's self-awareness layer
 *
 * Tracks, annotates, and monitors the health of any entity:
 * skills, tools, services, integrations, scripts — anything.
 *
 * Three core capabilities:
 * 1. Gap detection — spots missing capabilities from error/response text
 * 2. Annotations — persistent notes attached to any tracked entity
 * 3. Quality tracking — up/down ratings with labels, health scores
 *
 * Originally extracted from Context Hub (andrewyng/context-hub) patterns.
 * Renamed from skill-learner.js to cortex.js for broader, reusable use.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import pino from 'pino';

const logger = pino({ level: 'info' });

const DATA_DIR = '/app/data/cortex';
const REGISTRY_FILE = join(DATA_DIR, 'registry.json');
const ANNOTATIONS_DIR = join(DATA_DIR, 'annotations');
const FEEDBACK_FILE = join(DATA_DIR, 'feedback.json');

// Legacy paths — for migration
const LEGACY_SKILLS_FILE = '/app/data/acquired-skills.json';
const LEGACY_ANNOTATIONS_DIR = '/app/data/skill-annotations';
const LEGACY_FEEDBACK_FILE = '/app/data/skill-feedback.json';

function ensureDataDir() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(ANNOTATIONS_DIR, { recursive: true });
}

// Migrate legacy data if it exists and new data doesn't
function migrateLegacy() {
  ensureDataDir();
  try {
    if (!existsSync(REGISTRY_FILE) && existsSync(LEGACY_SKILLS_FILE)) {
      const old = JSON.parse(readFileSync(LEGACY_SKILLS_FILE, 'utf8'));
      // Convert to new format with entity types
      const registry = {
        entities: old.acquired.map(s => ({ ...s, type: 'skill', status: 'active' })),
        inProgress: old.inProgress.map(s => ({ ...s, type: 'skill' })),
        failed: old.failed.map(s => ({ ...s, type: 'skill' })),
      };
      writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
      logger.info('Migrated legacy skills to cortex registry');
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Legacy migration skipped');
  }
  try {
    if (!existsSync(FEEDBACK_FILE) && existsSync(LEGACY_FEEDBACK_FILE)) {
      const old = JSON.parse(readFileSync(LEGACY_FEEDBACK_FILE, 'utf8'));
      writeFileSync(FEEDBACK_FILE, JSON.stringify(old, null, 2));
      logger.info('Migrated legacy feedback to cortex');
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Legacy feedback migration skipped');
  }
  try {
    if (existsSync(LEGACY_ANNOTATIONS_DIR)) {
      const files = readdirSync(LEGACY_ANNOTATIONS_DIR).filter(f => f.endsWith('.json'));
      for (const f of files) {
        const dest = join(ANNOTATIONS_DIR, f);
        if (!existsSync(dest)) {
          const content = readFileSync(join(LEGACY_ANNOTATIONS_DIR, f), 'utf8');
          writeFileSync(dest, content);
        }
      }
      if (files.length > 0) logger.info({ count: files.length }, 'Migrated legacy annotations to cortex');
    }
  } catch (e) {
    logger.warn({ err: e.message }, 'Legacy annotation migration skipped');
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
// REGISTRY — tracks any entity (skill, tool, service, script)
// ============================================================

const ENTITY_TYPES = ['skill', 'tool', 'service', 'script', 'integration'];

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

// Backward-compatible — loadSkills() still works
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
  logger.info({ name, type, source }, 'Cortex: entity registered');
  return true;
}

// Backward-compatible alias
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

// Backward-compatible alias
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
  logger.info({ entity: name, type }, 'Cortex: annotation saved');
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
  logger.info({ entity: name, rating, labels: validLabels }, 'Cortex: feedback recorded');
  return feedback[name];
}

// Backward-compatible alias
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

// Backward-compatible alias
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

// Backward-compatible alias
export function getSkillsNeedingAttention() {
  return getEntitiesNeedingAttention();
}

// ============================================================
// FORMATTED OUTPUT
// ============================================================

export function formatRegistry(filterType = null) {
  const registry = loadRegistry();
  const entities = filterType
    ? registry.entities.filter(e => e.type === filterType)
    : registry.entities;
  const lines = ['🧠 *Cortex Registry*\n'];

  if (entities.length > 0) {
    // Group by type
    const byType = {};
    for (const e of entities) {
      const t = e.type || 'skill';
      if (!byType[t]) byType[t] = [];
      byType[t].push(e);
    }

    for (const [type, items] of Object.entries(byType)) {
      lines.push(`*${type.charAt(0).toUpperCase() + type.slice(1)}s (${items.length}):*`);
      for (const e of items) {
        const date = new Date(e.acquiredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const annotation = readAnnotation(e.name);
        const feedback = getFeedbackSummary(e.name);
        let suffix = `(${date})`;
        if (annotation) suffix += ' 📝';
        if (feedback && feedback.downCount > 0) suffix += ` ⚠️${feedback.downCount}`;
        lines.push(`  ✅ ${e.name} — ${e.description || '(no description)'} ${suffix}`);
      }
    }
  } else {
    lines.push('No entities tracked yet.');
  }

  if (registry.inProgress.length > 0) {
    lines.push(`\n*In Progress (${registry.inProgress.length}):*`);
    for (const e of registry.inProgress) {
      lines.push(`  🔄 ${e.name} — ${e.gap}`);
    }
  }

  if (registry.failed.length > 0) {
    lines.push(`\n*Failed (${registry.failed.length}):*`);
    for (const e of registry.failed.slice(-5)) {
      lines.push(`  ❌ ${e.name} — ${e.reason}`);
    }
  }

  const needsAttention = getEntitiesNeedingAttention();
  if (needsAttention.length > 0) {
    lines.push(`\n*Needs Attention (${needsAttention.length}):*`);
    for (const e of needsAttention.slice(0, 5)) {
      lines.push(`  🔧 ${e.name} — ${e.reason}`);
    }
  }

  return lines.join('\n');
}

// Backward-compatible alias
export function formatSkillsList() {
  return formatRegistry('skill');
}

export { VALID_LABELS, ENTITY_TYPES };
