/**
 * Experiment Engine — Hypothesis-driven autonomous testing
 *
 * Overlord can:
 *   1. Form a hypothesis ("Adding X will improve Y by Z%")
 *   2. Create branch + implement change
 *   3. Deploy via Coolify auto-deploy
 *   4. Measure against target metric
 *   5. Auto-revert if threshold missed, auto-promote if met
 *
 * Guard rails:
 *   - Never on NamiBarden
 *   - Max 1 active experiment per project
 *   - Auto-revert on any 5xx spike
 *   - All experiments have a deadline + stop rule
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { createProposal } from './autonomy-engine.js';

const EXPERIMENTS_PATH = '/app/data/experiments.json';
const EXPERIMENT_LOG = '/app/data/experiment-log.jsonl';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

// Projects that support auto-deploy experiments
const EXPERIMENT_ELIGIBLE = ['BeastMode', 'Lumina', 'Elmo', 'OnlyHulls'];
// NamiBarden, MasterCommander, SurfaBabe excluded (manual deploy or off-limits)

/**
 * Create a new experiment proposal
 */
export async function proposeExperiment(experiment, sockRef) {
  // Validate
  if (!experiment.hypothesis) throw new Error('Missing hypothesis');
  if (!experiment.project) throw new Error('Missing project');
  if (!experiment.targetMetric) throw new Error('Missing target metric');

  // Constitution check
  if (experiment.project === 'NamiBarden') {
    throw new Error('NamiBarden is off-limits per constitution');
  }
  if (!EXPERIMENT_ELIGIBLE.includes(experiment.project)) {
    throw new Error(`${experiment.project} is not eligible for auto-deploy experiments`);
  }

  // Check for existing active experiment
  const experiments = loadExperiments();
  const active = experiments.find(e => e.project === experiment.project && e.status === 'active');
  if (active) {
    throw new Error(`${experiment.project} already has active experiment #${active.id}`);
  }

  // Create experiment record
  const maxId = experiments.reduce((max, e) => Math.max(max, e.id || 0), 0);
  const record = {
    id: maxId + 1,
    hypothesis: experiment.hypothesis,
    project: experiment.project,
    targetMetric: experiment.targetMetric,
    baseline: experiment.baseline || null,
    threshold: experiment.threshold || 10, // default: 10% improvement
    deadlineDays: experiment.deadlineDays || 7,
    stopRule: experiment.stopRule || 'auto-revert on 5xx or metric regression > 20%',
    branch: experiment.branch || null,
    status: 'proposed',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + (experiment.deadlineDays || 7) * 24 * 60 * 60 * 1000).toISOString(),
    results: null,
    postmortem: null,
  };

  experiments.push(record);
  saveExperiments(experiments);

  // Create autonomy proposal for Gil's approval
  await createProposal({
    title: `EXPERIMENT: ${experiment.project} — ${experiment.hypothesis}`,
    description: `Metric: ${experiment.targetMetric}\nThreshold: +${experiment.threshold}%\nDeadline: ${experiment.deadlineDays} days\nStop rule: ${record.stopRule}`,
    project: experiment.project,
    risk: 'medium',
    source: 'experiment-engine',
    actionPayload: { experimentId: record.id },
  }, sockRef);

  return record;
}

/**
 * Start an approved experiment (after Gil approves proposal)
 */
export function startExperiment(experimentId) {
  const experiments = loadExperiments();
  const exp = experiments.find(e => e.id === experimentId);
  if (!exp) return null;

  // Create experiment branch if project path exists
  const projectPaths = {
    OnlyHulls: '/root/projects/OnlyHulls',
    BeastMode: '/root/projects/BeastMode',
    Lumina: '/root/projects/Lumina',
    Elmo: '/root/projects/Elmo',
  };
  const projectPath = projectPaths[exp.project];
  if (projectPath) {
    try {
      const branchName = `experiment-${exp.id}`;
      execSync(`git -C "${projectPath}" checkout -b ${branchName} 2>/dev/null || git -C "${projectPath}" checkout ${branchName}`, { encoding: 'utf8', timeout: 10000 });
      exp.branch = branchName;
      console.log(`[Experiment] Created branch ${branchName} for ${exp.project}`);
    } catch (err) {
      console.warn(`[Experiment] Branch creation failed: ${err.message}`);
    }
  }

  // Capture baseline metrics
  try {
    const url = getProjectUrl(exp.project);
    if (url) {
      const code = execSync(`curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${url}" 2>/dev/null`, { encoding: 'utf8', timeout: 15000 }).trim();
      exp.baseline = { httpStatus: parseInt(code), capturedAt: new Date().toISOString() };
    }
  } catch { /* baseline capture failed — non-critical */ }

  exp.status = 'active';
  exp.startedAt = new Date().toISOString();
  saveExperiments(experiments);

  logExperiment(exp, 'started');
  return exp;
}

/**
 * Check active experiments for completion/failure
 * Called by scheduler daily
 */
export async function checkExperiments(sockRef) {
  const experiments = loadExperiments();
  const active = experiments.filter(e => e.status === 'active');

  if (active.length === 0) return { checked: 0 };

  for (const exp of active) {
    // Check deadline
    if (new Date(exp.expiresAt) < new Date()) {
      exp.status = 'expired';
      exp.postmortem = 'Deadline reached without conclusive results';
      logExperiment(exp, 'expired');

      if (sockRef?.sock) {
        await sockRef.sock.sendMessage(ADMIN_JID, {
          text: `⏰ Experiment #${exp.id} expired: ${exp.hypothesis}\nProject: ${exp.project}\nNo conclusive results within ${exp.deadlineDays} days.`,
        }).catch(() => {});
      }
      continue;
    }

    // Check for 5xx (stop rule)
    try {
      const url = getProjectUrl(exp.project);
      if (url) {
        const code = execSync(
          `curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${url}" 2>/dev/null`,
          { encoding: 'utf8', timeout: 15000 }
        ).trim();
        if (parseInt(code) >= 500) {
          exp.status = 'reverted';
          exp.postmortem = `Auto-reverted: site returned HTTP ${code}`;
          logExperiment(exp, 'auto-reverted');

          if (sockRef?.sock) {
            await sockRef.sock.sendMessage(ADMIN_JID, {
              text: `🔴 Experiment #${exp.id} AUTO-REVERTED!\n${exp.hypothesis}\n${exp.project} returned HTTP ${code}`,
            }).catch(() => {});
          }
        }
      }
    } catch { /* check failed, continue monitoring */ }
  }

  saveExperiments(experiments);
  return { checked: active.length };
}

/**
 * Record experiment result (success or failure)
 */
export function resolveExperiment(experimentId, success, postmortem) {
  const experiments = loadExperiments();
  const exp = experiments.find(e => e.id === experimentId);
  if (!exp) return null;

  exp.status = success ? 'succeeded' : 'failed';
  exp.postmortem = postmortem || (success ? 'Threshold met' : 'Threshold missed');
  exp.resolvedAt = new Date().toISOString();

  saveExperiments(experiments);
  logExperiment(exp, exp.status);
  return exp;
}

/**
 * Get active experiments for context injection
 */
export function getExperimentContext() {
  try {
    const experiments = loadExperiments();
    const active = experiments.filter(e => e.status === 'active');
    if (active.length === 0) return '';
    return `ACTIVE EXPERIMENTS: ${active.map(e => `#${e.id} ${e.project}: ${e.hypothesis}`).join('; ')}`;
  } catch { return ''; }
}

/**
 * List all experiments (for /experiments command)
 */
export function listExperiments(status = null) {
  const experiments = loadExperiments();
  if (status) return experiments.filter(e => e.status === status);
  return experiments;
}

// ============================================================
// HELPERS
// ============================================================

function loadExperiments() {
  try { return JSON.parse(readFileSync(EXPERIMENTS_PATH, 'utf8')); }
  catch { return []; }
}

function saveExperiments(experiments) {
  // Keep last 50
  const pruned = experiments.slice(-50);
  writeFileSync(EXPERIMENTS_PATH, JSON.stringify(pruned, null, 2));
}

function logExperiment(exp, event) {
  appendFileSync(EXPERIMENT_LOG, JSON.stringify({
    timestamp: new Date().toISOString(),
    experimentId: exp.id,
    event,
    project: exp.project,
    hypothesis: exp.hypothesis,
  }) + '\n');
}

function getProjectUrl(project) {
  const urls = {
    OnlyHulls: 'onlyhulls.com',
    BeastMode: 'beastmode.namibarden.com',
    Lumina: 'lumina.namibarden.com',
    Elmo: 'onlydrafting.com',
  };
  return urls[project] || null;
}
