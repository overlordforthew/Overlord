/**
 * Autonomy Engine — Tiered decision layer for Overlord autonomous actions
 *
 * Two tiers:
 *   AUTO-FIX: Known fix pattern, success_count >= 2, not destructive → execute silently
 *   PROPOSE:  Novel/architectural/low-confidence → send proposal to Gil, wait for reply
 *
 * Used by:
 *   - executor.js (wraps autonomous tasks)
 *   - strategic-patrol.js (classifies patrol findings)
 *   - scheduler.js (error watcher actions)
 */

import { readFileSync, writeFileSync } from 'fs';
import { findMatchingPatterns, initFixPatterns } from './fix-patterns.js';

const PROPOSALS_PATH = process.env.PROPOSALS_PATH || '/root/overlord/data/proposals.json';
const COOLOFF_PATH = '/root/overlord/data/autonomy-cooloff.json';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

// Protected projects — enforced in code, not just docs
const PROTECTED_PROJECTS = ['NamiBarden'];

// Operational noise — auto-dismiss, don't even propose
const NOISE_PATTERNS = [
  'exit code 143', 'sigterm', 'sigkill', 'oom killed',
  'signal: killed', 'code 143', 'exit code 137',
];

/**
 * Check if a project is protected (off-limits for autonomous actions)
 */
export function isProtectedProject(name) {
  if (!name) return false;
  return PROTECTED_PROJECTS.some(p => p.toLowerCase() === name.toLowerCase());
}

// Actions in these categories always require proposal
const DESTRUCTIVE_KEYWORDS = [
  'delete', 'drop', 'remove', 'force-push', 'reset --hard',
  'kill', 'rm -rf', 'truncate', 'destroy', 'expose port',
  'refund', 'payment', 'billing', 'firewall', 'iptables',
];

// Architecture-level changes always require proposal
const ARCHITECTURAL_KEYWORDS = [
  'migrate', 'schema change', 'new service', 'new project',
  'restructure', 'refactor', 'redesign', 'major version',
  'breaking change', 'new dependency', 'remove feature',
];

/**
 * Classify whether an action should auto-fix or require a proposal.
 *
 * @param {object} action - { title, description, project, source, symptom }
 * @returns {Promise<{ tier: 'auto-fix'|'propose', reason: string, confidence: number, patterns: Array }>}
 */
export async function classifyAction(action) {
  const text = `${action.title || ''} ${action.description || ''} ${action.symptom || ''}`.toLowerCase();

  // Rule 0: Protected projects — hard block
  if (isProtectedProject(action.project)) {
    return { tier: 'propose', reason: `Protected project: ${action.project} — requires explicit approval`, confidence: 1.0, patterns: [] };
  }

  // Rule 0b: Operational noise — auto-dismiss (don't propose, don't fix)
  for (const noise of NOISE_PATTERNS) {
    if (text.includes(noise)) {
      return { tier: 'dismiss', reason: `Operational noise: "${noise}"`, confidence: 1.0, patterns: [] };
    }
  }

  // Rule 1: Destructive actions always require proposal
  for (const kw of DESTRUCTIVE_KEYWORDS) {
    if (text.includes(kw)) {
      return { tier: 'propose', reason: `Destructive action detected: "${kw}"`, confidence: 1.0, patterns: [] };
    }
  }

  // Rule 2: Architectural changes always require proposal
  for (const kw of ARCHITECTURAL_KEYWORDS) {
    if (text.includes(kw)) {
      return { tier: 'propose', reason: `Architectural change: "${kw}"`, confidence: 1.0, patterns: [] };
    }
  }

  // Rule 3: Check cool-off list (previously failed auto-fixes)
  const cooloffs = loadCooloffs();
  const cooloffKey = buildCooloffKey(action);
  if (cooloffs[cooloffKey] && Date.now() - cooloffs[cooloffKey].ts < 48 * 60 * 60 * 1000) {
    return { tier: 'propose', reason: `Cool-off: auto-fix failed previously (${cooloffs[cooloffKey].reason})`, confidence: 0.8, patterns: [] };
  }

  // Rule 4: Check fix patterns
  try {
    await initFixPatterns();
    const symptomText = action.symptom || action.title || action.description || '';
    const patterns = await findMatchingPatterns(symptomText, action.project);

    if (patterns.length > 0) {
      const best = patterns[0];
      // Auto-fix threshold: success_count >= 2 and positive track record
      if (best.success_count >= 2 && best.success_count > best.failure_count) {
        return {
          tier: 'auto-fix',
          reason: `Known fix: "${best.fix_description}" (${best.success_count} successes)`,
          confidence: best.success_count / (best.success_count + best.failure_count),
          patterns,
        };
      }
      // Pattern exists but not confident enough
      return {
        tier: 'propose',
        reason: `Fix pattern exists but low confidence (${best.success_count}s/${best.failure_count}f)`,
        confidence: 0.4,
        patterns,
      };
    }
  } catch { /* fix patterns DB unavailable — default to propose */ }

  // Rule 5: Trusted operational sources — auto-fix without proposal
  if (action.source === 'heartbeat' || action.source === 'session-guard') {
    return { tier: 'auto-fix', reason: 'Trusted operational source', confidence: 0.7, patterns: [] };
  }

  // Rule 6: Observer-sourced tasks (container crashes, 5xx spikes) — investigate autonomously
  // Don't propose blind fixes. Investigate first, fix if safe, escalate only with diagnosis.
  if (action.source === 'observer') {
    return { tier: 'auto-fix', reason: 'Auto-investigate: novel issue from observer — will diagnose before acting', confidence: 0.5, patterns: [] };
  }

  // Default: propose (patrol findings, manual triggers, etc.)
  return { tier: 'propose', reason: 'No matching fix pattern — novel action', confidence: 0.3, patterns: [] };
}

// ============================================================
// PROPOSALS
// ============================================================

/**
 * Create a proposal and queue it for WhatsApp delivery.
 *
 * @param {object} action - { title, description, project, risk, source }
 * @param {object} sockRef - { sock } for WhatsApp send
 * @returns {object} The created proposal
 */
export async function createProposal(action, sockRef) {
  // Blast radius enforcement
  if (isProtectedProject(action.project)) {
    console.warn(`[Autonomy] Blocked proposal for protected project: ${action.project}`);
    return null;
  }

  const proposals = loadProposals();

  // Auto-increment ID
  const maxId = proposals.reduce((max, p) => Math.max(max, p.id || 0), 0);
  const proposal = {
    id: maxId + 1,
    title: action.title,
    description: action.description || '',
    project: action.project || null,
    risk: action.risk || 'medium',
    source: action.source || 'patrol',
    status: 'pending',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
    actionPayload: action.actionPayload || null,
  };

  proposals.push(proposal);
  saveProposals(proposals);

  // Send to Gil via WhatsApp
  if (sockRef?.sock) {
    const riskEmoji = { low: '🟢', medium: '🟡', high: '🔴' }[proposal.risk] || '🟡';
    const msg = [
      `${riskEmoji} *PROPOSAL #${proposal.id}*`,
      `${proposal.title}`,
      proposal.description ? `\n${proposal.description}` : '',
      proposal.project ? `\nProject: ${proposal.project}` : '',
      `\nReply "ok ${proposal.id}" to approve or "no ${proposal.id}" to dismiss`,
    ].filter(Boolean).join('');

    try {
      await sockRef.sock.sendMessage(ADMIN_JID, { text: msg });
    } catch (err) {
      console.error(`[Autonomy] Failed to send proposal #${proposal.id}:`, err.message);
    }
  }

  return proposal;
}

/**
 * Resolve a proposal (approve or reject).
 *
 * @param {number} id - Proposal ID
 * @param {boolean} approved - Whether Gil approved
 * @returns {object|null} The resolved proposal or null if not found
 */
export function resolveProposal(id, approved) {
  const proposals = loadProposals();
  const idx = proposals.findIndex(p => p.id === id && p.status === 'pending');
  if (idx === -1) return null;

  proposals[idx].status = approved ? 'approved' : 'rejected';
  proposals[idx].resolvedAt = new Date().toISOString();
  saveProposals(proposals);
  return proposals[idx];
}

/**
 * Get all pending proposals (not expired).
 */
export function getPendingProposals() {
  const now = Date.now();
  return loadProposals().filter(p =>
    p.status === 'pending' && new Date(p.expiresAt).getTime() > now
  );
}

/**
 * Record an auto-fix failure → cool off that pattern.
 */
export function recordAutoFixFailure(action, reason) {
  const cooloffs = loadCooloffs();
  cooloffs[buildCooloffKey(action)] = { reason, ts: Date.now() };
  saveCooloffs(cooloffs);
}

// ============================================================
// PERSISTENCE HELPERS
// ============================================================

function loadProposals() {
  try {
    return JSON.parse(readFileSync(PROPOSALS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveProposals(proposals) {
  // Prune old resolved/expired proposals (keep last 50)
  const now = Date.now();
  const active = proposals.filter(p =>
    p.status === 'pending' || new Date(p.resolvedAt || p.expiresAt).getTime() > now - 7 * 24 * 60 * 60 * 1000
  );
  const pruned = active.slice(-50);
  writeFileSync(PROPOSALS_PATH, JSON.stringify(pruned, null, 2));
}

function loadCooloffs() {
  try {
    return JSON.parse(readFileSync(COOLOFF_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function saveCooloffs(cooloffs) {
  // Prune entries older than 48h
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  const pruned = {};
  for (const [k, v] of Object.entries(cooloffs)) {
    if (v.ts > cutoff) pruned[k] = v;
  }
  writeFileSync(COOLOFF_PATH, JSON.stringify(pruned, null, 2));
}

function buildCooloffKey(action) {
  return `${action.project || 'global'}:${(action.title || '').slice(0, 60)}`.toLowerCase().replace(/\s+/g, '-');
}
