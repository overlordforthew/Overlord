/**
 * Skill Acquisition Loop (#9) — Self-evolving capabilities
 *
 * When a task fails because of a missing capability, auto-creates
 * a skill acquisition task to research, build, test, and register the skill.
 * /skills command to list acquired skills.
 *
 * Patterns extracted from Context Hub (andrewyng/context-hub):
 * - Annotation system: persistent agent notes attached to skills
 * - Feedback/quality tracking: structured ratings with labels
 * - Skill health scoring: surfaces which skills need attention
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import pino from 'pino';

const logger = pino({ level: 'info' });

const SKILLS_FILE = '/app/data/acquired-skills.json';
const ANNOTATIONS_DIR = '/app/data/skill-annotations';
const FEEDBACK_FILE = '/app/data/skill-feedback.json';

// Patterns that indicate a capability gap (not just a bug)
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

export function loadSkills() {
  try {
    return JSON.parse(readFileSync(SKILLS_FILE, 'utf-8'));
  } catch {
    return { acquired: [], inProgress: [], failed: [] };
  }
}

function saveSkills(skills) {
  writeFileSync(SKILLS_FILE, JSON.stringify(skills, null, 2));
}

export function registerSkill(name, description, source = 'auto') {
  const skills = loadSkills();
  // Check for duplicates
  if (skills.acquired.find(s => s.name.toLowerCase() === name.toLowerCase())) return false;

  skills.acquired.push({
    name,
    description,
    source,
    acquiredAt: new Date().toISOString(),
  });
  // Remove from inProgress if it was there
  skills.inProgress = skills.inProgress.filter(s => s.name.toLowerCase() !== name.toLowerCase());
  saveSkills(skills);
  logger.info({ name, source }, 'New skill acquired');
  return true;
}

export function markSkillInProgress(name, gap) {
  const skills = loadSkills();
  if (skills.inProgress.find(s => s.name === name)) return; // Already in progress
  if (skills.acquired.find(s => s.name.toLowerCase() === name.toLowerCase())) return; // Already acquired

  skills.inProgress.push({
    name,
    gap,
    startedAt: new Date().toISOString(),
  });
  saveSkills(skills);
}

export function markSkillFailed(name, reason) {
  const skills = loadSkills();
  skills.inProgress = skills.inProgress.filter(s => s.name !== name);
  skills.failed.push({ name, reason, failedAt: new Date().toISOString() });
  // Keep only last 20 failures
  if (skills.failed.length > 20) skills.failed = skills.failed.slice(-20);
  saveSkills(skills);
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

export function formatSkillsList() {
  const skills = loadSkills();
  const lines = ['🧠 *Skill Registry*\n'];

  if (skills.acquired.length > 0) {
    lines.push(`*Acquired (${skills.acquired.length}):*`);
    for (const s of skills.acquired) {
      const date = new Date(s.acquiredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const annotation = readAnnotation(s.name);
      const feedback = getSkillFeedbackSummary(s.name);
      let suffix = `(${date})`;
      if (annotation) suffix += ' 📝';
      if (feedback && feedback.downCount > 0) suffix += ` ⚠️${feedback.downCount}`;
      lines.push(`  ✅ ${s.name} — ${s.description || '(no description)'} ${suffix}`);
    }
  } else {
    lines.push('No skills acquired yet.');
  }

  if (skills.inProgress.length > 0) {
    lines.push(`\n*In Progress (${skills.inProgress.length}):*`);
    for (const s of skills.inProgress) {
      lines.push(`  🔄 ${s.name} — ${s.gap}`);
    }
  }

  if (skills.failed.length > 0) {
    lines.push(`\n*Failed (${skills.failed.length}):*`);
    for (const s of skills.failed.slice(-5)) {
      lines.push(`  ❌ ${s.name} — ${s.reason}`);
    }
  }

  // Show skills needing attention
  const needsAttention = getSkillsNeedingAttention();
  if (needsAttention.length > 0) {
    lines.push(`\n*Needs Attention (${needsAttention.length}):*`);
    for (const s of needsAttention.slice(0, 5)) {
      lines.push(`  🔧 ${s.name} — ${s.reason}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// ANNOTATION SYSTEM (extracted from Context Hub)
// Persistent agent notes attached to skills. When a skill has
// a known issue, caveat, or workaround, annotate it so the
// note surfaces every time the skill is loaded.
// ============================================================

function annotationPath(skillName) {
  const safe = skillName.replace(/\//g, '--').replace(/\s+/g, '-').toLowerCase();
  return join(ANNOTATIONS_DIR, `${safe}.json`);
}

export function readAnnotation(skillName) {
  try {
    return JSON.parse(readFileSync(annotationPath(skillName), 'utf8'));
  } catch {
    return null;
  }
}

export function writeAnnotation(skillName, note) {
  mkdirSync(ANNOTATIONS_DIR, { recursive: true });
  const existing = readAnnotation(skillName);
  const data = {
    skill: skillName,
    note,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updateCount: (existing?.updateCount || 0) + 1,
  };
  writeFileSync(annotationPath(skillName), JSON.stringify(data, null, 2));
  logger.info({ skill: skillName }, 'Skill annotated');
  return data;
}

export function clearAnnotation(skillName) {
  try {
    unlinkSync(annotationPath(skillName));
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
// FEEDBACK / QUALITY TRACKING (extracted from Context Hub)
// Structured ratings with labels so skills self-report quality.
// When an agent uses a skill and it works well → up.
// When it fails, is outdated, or incomplete → down + labels.
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
  writeFileSync(FEEDBACK_FILE, JSON.stringify(data, null, 2));
}

export function feedbackSkill(skillName, rating, labels = [], comment = '') {
  if (rating !== 'up' && rating !== 'down') return null;
  const validLabels = labels.filter(l => VALID_LABELS.includes(l));

  const feedback = loadFeedback();
  if (!feedback[skillName]) {
    feedback[skillName] = { up: 0, down: 0, entries: [] };
  }

  feedback[skillName][rating]++;
  feedback[skillName].entries.push({
    rating,
    labels: validLabels,
    comment: comment.substring(0, 300),
    at: new Date().toISOString(),
  });

  // Keep last 50 entries per skill
  if (feedback[skillName].entries.length > 50) {
    feedback[skillName].entries = feedback[skillName].entries.slice(-50);
  }

  saveFeedback(feedback);
  logger.info({ skill: skillName, rating, labels: validLabels }, 'Skill feedback recorded');
  return feedback[skillName];
}

export function getSkillFeedbackSummary(skillName) {
  const feedback = loadFeedback();
  const data = feedback[skillName];
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

// ============================================================
// SKILL HEALTH — surfaces which skills need attention
// Combines annotations + negative feedback to prioritize fixes
// ============================================================

export function getSkillsNeedingAttention() {
  const feedback = loadFeedback();
  const annotations = listAnnotations();
  const needsAttention = [];

  // Skills with negative feedback ratio
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

  // Skills with annotations that mention issues
  for (const a of annotations) {
    const issueWords = ['broken', 'fails', 'outdated', 'fix', 'bug', 'wrong', 'error'];
    const hasIssue = issueWords.some(w => a.note.toLowerCase().includes(w));
    if (hasIssue && !needsAttention.find(n => n.name === a.skill)) {
      needsAttention.push({
        name: a.skill,
        reason: `Annotated: ${a.note.substring(0, 80)}`,
        score: 0.5,
        priority: 2,
      });
    }
  }

  return needsAttention.sort((a, b) => a.priority - b.priority || a.score - b.score);
}

export { VALID_LABELS };
