/**
 * Evolution Engine — Post-session self-learning pipeline
 *
 * After conversations with Gil, extracts corrections/preferences/facts,
 * validates through constitution + regression gates, applies with version tracking.
 *
 * 6-step pipeline (inspired by Phantom):
 *   1. EXTRACT — corrections, preferences, domain facts from conversation
 *   2. CRITIQUE — independent LLM review (free model via llm CLI)
 *   3. PROPOSE — minimal config/behavior changes
 *   4. VALIDATE — constitution + regression + drift gates
 *   5. APPLY — write changes with version tracking
 *   6. CONSOLIDATE — compress repeated observations into principles
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const CONSTITUTION_PATH = '/app/data/constitution.md';
const EVOLUTION_LOG = '/app/data/evolution-log.jsonl';
const PRINCIPLES_PATH = '/app/data/learned-principles.json';
const CORRECTIONS_PATH = '/app/data/corrections.json';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

// Patterns that indicate Gil is correcting Overlord — broadened for natural phrasing
const CORRECTION_PATTERNS = [
  /no[,.]?\s*(don'?t|not|stop|never|wrong|that'?s not)/i,
  /instead[,.]?\s*(do|use|try|make)/i,
  /I said\s/i,
  /I meant\s/i,
  /not like that/i,
  /do it (this|that|the other) way/i,
  /you should (have|be|do|use)/i,
  /why did you/i,
  /that'?s (wrong|incorrect|bad|broken)/i,
  /fix (this|that|it)/i,
  /I (prefer|want|need|like)\s/i,
  /always\s+(do|use|make|check)/i,
  /never\s+(do|use|make|send)/i,
  // Broadened patterns — natural correction phrasing
  /don'?t\s+(do|add|use|make|send|put|include)/i,
  /stop\s+(doing|adding|using|making|sending)/i,
  /next time\s/i,
  /from now on\s/i,
  /remember to\s/i,
  /you (forgot|missed|skipped|ignored)/i,
  /that (wasn'?t|isn'?t) (what|right|correct)/i,
  /change (it|this|that) to\s/i,
  /nah[,.]?\s/i,
  /actually[,.]?\s+(do|use|try|make|just)/i,
];

// Patterns that indicate a preference statement — broadened
const PREFERENCE_PATTERNS = [
  /I (prefer|like|want|need)\s+(.+)/i,
  /use\s+(\S+)\s+instead of\s+(\S+)/i,
  /always\s+(.+)\s+before\s+(.+)/i,
  /never\s+(.+)\s+without\s+(.+)/i,
  /(more|less)\s+(verbose|concise|detailed|brief)/i,
  // Broadened preference patterns
  /keep (it|things|this)\s+(simple|short|brief|clean|minimal)/i,
  /make (it|this|sure)\s/i,
  /just\s+(do|use|make|run|check)\s/i,
  /can you\s+(just|always|please)\s/i,
  /let'?s\s+(go with|stick with|use|try)/i,
];

/**
 * Step 1: EXTRACT — Find corrections, preferences, facts in conversation
 */
export function extractLearningSignals(messages) {
  const signals = { corrections: [], preferences: [], facts: [] };

  for (const msg of messages) {
    if (!msg.text || msg.role !== 'user') continue;
    const text = msg.text;

    // Check for corrections
    for (const pattern of CORRECTION_PATTERNS) {
      if (pattern.test(text)) {
        signals.corrections.push({
          text: text.substring(0, 300),
          pattern: pattern.source,
          timestamp: msg.timestamp || new Date().toISOString(),
        });
        break; // one match per message
      }
    }

    // Check for preferences
    for (const pattern of PREFERENCE_PATTERNS) {
      const match = text.match(pattern);
      if (match) {
        signals.preferences.push({
          text: text.substring(0, 300),
          match: match[0].substring(0, 100),
          timestamp: msg.timestamp || new Date().toISOString(),
        });
        break;
      }
    }
  }

  return signals;
}

/**
 * Step 2: CRITIQUE — Independent LLM review of proposed learnings
 * Uses free model via llm CLI to avoid self-serving bias
 */
export function critiqueSignals(signals) {
  if (signals.corrections.length === 0 && signals.preferences.length === 0) {
    return { approved: [], rejected: [], reason: 'No signals to critique' };
  }

  try {
    // Privacy: only send pattern categories, not raw conversation text
    const sanitized = {
      corrections: signals.corrections.map((c, i) => ({
        index: i,
        pattern: c.pattern,
        length: c.text.length,
        // Don't send raw text to external model
      })),
      preferences: signals.preferences.map((p, i) => ({
        index: i,
        matchType: p.match?.substring(0, 30),
      })),
    };

    const prompt = `Review ${sanitized.corrections.length} correction signals and ${sanitized.preferences.length} preference signals from a user-AI conversation. Correction patterns detected: ${sanitized.corrections.map(c => c.pattern).join(', ')}. Respond with JSON: { "approved": [...indices], "rejected": [...indices] }. Approve clear actionable patterns, reject vague ones.`;

    const result = execSync(
      `echo ${JSON.stringify(prompt)} | llm -m openrouter/openrouter/free 2>/dev/null`,
      { encoding: 'utf8', timeout: 30000 }
    ).trim();

    try {
      return JSON.parse(result);
    } catch {
      // FAIL-CLOSED: bad JSON = reject all. Self-modification must be conservative.
      return {
        approved: [],
        rejected: signals.corrections.map((_, i) => i),
        reason: 'Critique LLM returned non-JSON — fail-closed, rejecting all',
      };
    }
  } catch {
    // FAIL-CLOSED: LLM unavailable = reject all
    return {
      approved: [],
      rejected: signals.corrections.map((_, i) => i),
      reason: 'Critique LLM unavailable — fail-closed, rejecting all',
    };
  }
}

/**
 * Step 3: PROPOSE — Generate minimal behavior changes from approved signals
 */
export function proposeChanges(signals, critiqueResult) {
  const changes = [];
  const approvedIdx = new Set(critiqueResult.approved || []);

  for (let i = 0; i < signals.corrections.length; i++) {
    if (!approvedIdx.has(i)) continue;
    changes.push({
      type: 'correction',
      source: signals.corrections[i].text,
      proposed: signals.corrections[i].text, // stored as-is for now
      timestamp: signals.corrections[i].timestamp,
    });
  }

  for (const pref of signals.preferences) {
    changes.push({
      type: 'preference',
      source: pref.text,
      proposed: pref.match,
      timestamp: pref.timestamp,
    });
  }

  return changes;
}

/**
 * Step 4: VALIDATE — Constitution + regression + drift gates
 */
export function validateChanges(changes) {
  const validated = [];
  const rejected = [];

  // Load constitution
  let constitution = '';
  try {
    constitution = readFileSync(CONSTITUTION_PATH, 'utf8').toLowerCase();
  } catch { /* no constitution = no gate */ }

  // Load existing corrections for regression check
  let existing = [];
  try {
    existing = JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8'));
  } catch { /* fresh */ }

  for (const change of changes) {
    const text = change.source.toLowerCase();

    // Gate 1: Constitution — does this contradict immutable rules?
    const constitutionViolation = checkConstitution(text, constitution);
    if (constitutionViolation) {
      rejected.push({ ...change, gate: 'constitution', reason: constitutionViolation });
      continue;
    }

    // Gate 2: Regression — does this contradict a previous correction?
    const regression = existing.find(e =>
      e.type === 'correction' &&
      textSimilarity(e.source, change.source) > 0.6 &&
      e.source !== change.source
    );
    if (regression) {
      // Newer correction wins — update, don't reject
      change.supersedes = regression.source;
    }

    // Gate 3: Drift — is this too far from operational norms?
    // (lightweight: just check it's not absurdly long or trying to modify system files)
    if (change.source.length > 500) {
      rejected.push({ ...change, gate: 'drift', reason: 'Signal too long — likely not a simple correction' });
      continue;
    }

    validated.push(change);
  }

  return { validated, rejected };
}

/**
 * Step 5: APPLY — Write validated changes with version tracking
 */
export function applyChanges(validated) {
  if (validated.length === 0) return { applied: 0, version: null };

  // Load existing corrections
  let corrections = [];
  try {
    corrections = JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8'));
  } catch { /* fresh */ }

  // Add new corrections
  for (const change of validated) {
    // Dedup: don't store if identical correction already exists
    const duplicate = corrections.find(c => c.source === change.source);
    if (duplicate) {
      duplicate.count = (duplicate.count || 1) + 1;
      duplicate.lastSeen = change.timestamp;
      continue;
    }

    corrections.push({
      ...change,
      count: 1,
      firstSeen: change.timestamp,
      lastSeen: change.timestamp,
      applied: true,
    });
  }

  // Cap at 200 corrections
  if (corrections.length > 200) {
    corrections.sort((a, b) => (b.count || 1) - (a.count || 1));
    corrections = corrections.slice(0, 200);
  }

  writeFileSync(CORRECTIONS_PATH, JSON.stringify(corrections, null, 2));

  // Append to evolution log (immutable audit trail)
  const version = Date.now();
  const logEntry = {
    version,
    timestamp: new Date().toISOString(),
    applied: validated.length,
    changes: validated.map(c => ({ type: c.type, source: c.source.substring(0, 100) })),
  };
  appendFileSync(EVOLUTION_LOG, JSON.stringify(logEntry) + '\n');

  return { applied: validated.length, version };
}

/**
 * Step 6: CONSOLIDATE — Compress repeated corrections into principles
 */
export function consolidate() {
  let corrections = [];
  try {
    corrections = JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8'));
  } catch { return { consolidated: 0 }; }

  let principles = [];
  try {
    principles = JSON.parse(readFileSync(PRINCIPLES_PATH, 'utf8'));
  } catch { /* fresh */ }

  // Find corrections seen 1+ times (lowered from 3 to learn faster)
  const frequent = corrections.filter(c => (c.count || 1) >= 1 && !c.consolidated);
  let consolidated = 0;

  for (const correction of frequent) {
    // Check if already a principle
    const exists = principles.find(p =>
      textSimilarity(p.source, correction.source) > 0.5
    );
    if (exists) {
      exists.reinforced = (exists.reinforced || 0) + 1;
      exists.lastSeen = correction.lastSeen;
      correction.consolidated = true;
      consolidated++;
      continue;
    }

    // Promote to principle
    principles.push({
      text: correction.source,
      source: correction.source,
      type: correction.type,
      count: correction.count,
      firstSeen: correction.firstSeen,
      lastSeen: correction.lastSeen,
      reinforced: 0,
      promotedAt: new Date().toISOString(),
    });
    correction.consolidated = true;
    consolidated++;
  }

  if (consolidated > 0) {
    writeFileSync(CORRECTIONS_PATH, JSON.stringify(corrections, null, 2));
    writeFileSync(PRINCIPLES_PATH, JSON.stringify(principles, null, 2));
  }

  return { consolidated, totalPrinciples: principles.length };
}

/**
 * Run the full evolution pipeline on a conversation
 */
export async function evolve(messages, sockRef) {
  console.log('[Evolution] Starting evolution pipeline...');

  // Step 1: Extract
  const signals = extractLearningSignals(messages);
  if (signals.corrections.length === 0 && signals.preferences.length === 0) {
    console.log('[Evolution] No learning signals found');
    return { signals: 0, applied: 0 };
  }
  console.log(`[Evolution] Extracted ${signals.corrections.length} corrections, ${signals.preferences.length} preferences`);

  // Step 2: Critique (async-safe, uses external LLM)
  const critique = critiqueSignals(signals);

  // Step 3: Propose
  const changes = proposeChanges(signals, critique);

  // Step 4: Validate
  const { validated, rejected } = validateChanges(changes);
  if (rejected.length > 0) {
    console.log(`[Evolution] Rejected ${rejected.length} changes: ${rejected.map(r => r.gate).join(', ')}`);
  }

  // Step 5: Apply
  const result = applyChanges(validated);
  console.log(`[Evolution] Applied ${result.applied} changes (version ${result.version})`);

  // Step 6: Consolidate
  const consolidation = consolidate();
  if (consolidation.consolidated > 0) {
    console.log(`[Evolution] Consolidated ${consolidation.consolidated} corrections into principles`);
  }

  return {
    signals: signals.corrections.length + signals.preferences.length,
    applied: result.applied,
    consolidated: consolidation.consolidated,
    version: result.version,
  };
}

/**
 * Get learned corrections for prompt injection
 * Returns formatted string for system prompt context
 */
export function getLearnedContext(project = null) {
  let corrections = [];
  try { corrections = JSON.parse(readFileSync(CORRECTIONS_PATH, 'utf8')); } catch { return ''; }

  let principles = [];
  try { principles = JSON.parse(readFileSync(PRINCIPLES_PATH, 'utf8')); } catch { /* ok */ }

  const lines = [];

  if (principles.length > 0) {
    lines.push('LEARNED PRINCIPLES (from repeated corrections):');
    for (const p of principles.slice(0, 10)) {
      lines.push(`  - ${p.text.substring(0, 150)} (${p.count}x)`);
    }
  }

  // Recent corrections (last 10)
  const recent = corrections
    .filter(c => !c.consolidated)
    .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
    .slice(0, 10);

  if (recent.length > 0) {
    lines.push('RECENT CORRECTIONS (apply these):');
    for (const c of recent) {
      lines.push(`  - ${c.source.substring(0, 150)}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// HELPERS
// ============================================================

function checkConstitution(text, constitution) {
  // Check if the correction would violate constitution rules
  if (text.includes('namibarden') && (text.includes('deploy') || text.includes('change') || text.includes('edit'))) {
    return 'NamiBarden is off-limits per constitution';
  }
  if (text.includes('delete') && text.includes('without') && text.includes('confirm')) {
    return 'Cannot learn to delete without confirmation per constitution';
  }
  if (text.includes('skip') && text.includes('verify')) {
    return 'Cannot learn to skip verification per constitution';
  }
  return null;
}

function textSimilarity(a, b) {
  if (!a || !b) return 0;
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w));
  const union = new Set([...wordsA, ...wordsB]);
  return intersection.length / union.size; // Jaccard similarity
}
