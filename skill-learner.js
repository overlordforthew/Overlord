/**
 * Skill Acquisition Loop (#9) — Self-evolving capabilities
 *
 * When a task fails because of a missing capability, auto-creates
 * a skill acquisition task to research, build, test, and register the skill.
 * /skills command to list acquired skills.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import pino from 'pino';

const logger = pino({ level: 'info' });

const SKILLS_FILE = '/app/data/acquired-skills.json';

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
      lines.push(`  ✅ ${s.name} — ${s.description || '(no description)'} (${date})`);
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

  return lines.join('\n');
}
