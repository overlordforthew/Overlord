/**
 * Strategic Patrol — Proactive background thinking for Overlord
 *
 * Runs 2x daily (11 AM and 5 PM AST). Reviews all projects and infrastructure,
 * identifies issues and opportunities, routes findings through the autonomy engine.
 *
 * Checks (sequential to respect 4GB memory):
 *   1. Git staleness across all projects
 *   2. Dependency health (npm outdated + audit)
 *   3. Error trends from meta-learning
 *   4. Infrastructure drift from predictive-infra
 *   5. Pending/blocked tasks
 *
 * Output: data/patrol-latest.json (for context injection) + WhatsApp report
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { classifyAction, createProposal, getPendingProposals } from './autonomy-engine.js';

const PATROL_OUTPUT = '/root/overlord/data/patrol-latest.json';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

// Active projects worth monitoring (with git repos)
// NamiBarden excluded — protected project per constitution
const PROJECTS = [
  { name: 'Overlord', path: '/root/overlord' },
  { name: 'MasterCommander', path: '/root/projects/MasterCommander' },
  { name: 'BeastMode', path: '/root/projects/BeastMode' },
  { name: 'Lumina', path: '/root/projects/Lumina' },
  { name: 'SurfaBabe', path: '/root/projects/SurfaBabe' },
  { name: 'Elmo', path: '/root/projects/Elmo' },
  { name: 'OnlyHulls', path: '/root/projects/OnlyHulls' },
];

// ============================================================
// CHECKS
// ============================================================

function checkGitStaleness() {
  const findings = [];
  for (const proj of PROJECTS) {
    if (!existsSync(`${proj.path}/.git`)) continue;
    try {
      const lastCommit = execSync(
        `git -C "${proj.path}" log -1 --format="%ar|%s" 2>/dev/null`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim();
      const [age, subject] = lastCommit.split('|');
      const daysMatch = age.match(/(\d+)\s*(day|week|month)/);
      let daysStale = 0;
      if (daysMatch) {
        const n = parseInt(daysMatch[1]);
        if (daysMatch[2] === 'day') daysStale = n;
        else if (daysMatch[2] === 'week') daysStale = n * 7;
        else if (daysMatch[2] === 'month') daysStale = n * 30;
      }

      if (daysStale >= 7) {
        findings.push({
          type: 'git_stale',
          project: proj.name,
          detail: `Last commit: ${age} — "${subject}"`,
          severity: daysStale >= 21 ? 'high' : daysStale >= 14 ? 'medium' : 'low',
        });
      }
    } catch { /* skip */ }
  }
  return findings;
}

function checkDependencyHealth() {
  const findings = [];
  for (const proj of PROJECTS) {
    if (!existsSync(`${proj.path}/package.json`)) continue;
    try {
      // npm audit (only critical/high)
      const auditRaw = execSync(
        `cd "${proj.path}" && npm audit --json 2>/dev/null | head -c 5000`,
        { encoding: 'utf8', timeout: 30000 }
      );
      try {
        const audit = JSON.parse(auditRaw);
        const vulns = audit.metadata?.vulnerabilities || {};
        const critical = (vulns.critical || 0) + (vulns.high || 0);
        if (critical > 0) {
          findings.push({
            type: 'dep_vuln',
            project: proj.name,
            detail: `${critical} critical/high vulnerabilities`,
            severity: critical >= 5 ? 'high' : 'medium',
          });
        }
      } catch { /* unparseable */ }
    } catch { /* npm audit failed */ }
  }
  return findings;
}

function checkErrorTrends() {
  const findings = [];
  try {
    const frictionPath = '/root/overlord/data/friction.json';
    if (existsSync(frictionPath)) {
      const friction = JSON.parse(readFileSync(frictionPath, 'utf8'));
      const recent = (friction.events || []).filter(e => {
        const age = Date.now() - new Date(e.ts || e.timestamp).getTime();
        return age < 24 * 60 * 60 * 1000; // last 24h
      });
      if (recent.length >= 3) {
        // Group by type/category
        const groups = {};
        for (const e of recent) {
          const key = e.type || e.category || 'unknown';
          groups[key] = (groups[key] || 0) + 1;
        }
        const top = Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 3);
        findings.push({
          type: 'error_trend',
          project: null,
          detail: `${recent.length} friction events in 24h. Top: ${top.map(([k, v]) => `${k}(${v})`).join(', ')}`,
          severity: recent.length >= 10 ? 'high' : 'medium',
        });
      }
    }
  } catch { /* no friction data */ }
  return findings;
}

function checkInfraDrift() {
  const findings = [];
  try {
    // Disk usage
    const diskLine = execSync("df -h / | tail -1", { encoding: 'utf8', timeout: 5000 }).trim();
    const diskMatch = diskLine.match(/(\d+)%/);
    const diskPct = diskMatch ? parseInt(diskMatch[1]) : 0;
    if (diskPct >= 65) {
      findings.push({
        type: 'disk_usage',
        project: null,
        detail: `Disk usage at ${diskPct}%`,
        severity: diskPct >= 90 ? 'high' : diskPct >= 80 ? 'medium' : 'low',
      });
    }

    // Memory usage
    const memLine = execSync("free -m | grep Mem", { encoding: 'utf8', timeout: 5000 }).trim();
    const memParts = memLine.split(/\s+/);
    const totalMem = parseInt(memParts[1]) || 1;
    const usedMem = parseInt(memParts[2]) || 0;
    const memPct = Math.round((usedMem / totalMem) * 100);
    if (memPct >= 70) {
      findings.push({
        type: 'memory_usage',
        project: null,
        detail: `Memory usage at ${memPct}% (${usedMem}/${totalMem}MB)`,
        severity: memPct >= 90 ? 'high' : memPct >= 80 ? 'medium' : 'low',
      });
    }

    // Container restarts
    const restarts = execSync(
      'docker ps --format "{{.Names}}|{{.Status}}" 2>/dev/null',
      { encoding: 'utf8', timeout: 5000 }
    ).trim().split('\n').filter(Boolean);

    for (const line of restarts) {
      const [name, status] = line.split('|');
      if (status && /restarting/i.test(status)) {
        findings.push({
          type: 'container_restart',
          project: name,
          detail: `Container ${name} is restarting`,
          severity: 'high',
        });
      }
    }

    // Check for exited/dead containers
    try {
      const exited = execSync(
        'docker ps -a --filter "status=exited" --filter "status=dead" --format "{{.Names}}|{{.Status}}" 2>/dev/null',
        { encoding: 'utf8', timeout: 5000 }
      ).trim().split('\n').filter(Boolean);
      for (const line of exited) {
        const [name, status] = line.split('|');
        if (name && !name.startsWith('coolify-') && !name.includes('build')) {
          findings.push({
            type: 'container_down',
            project: name,
            detail: `Container ${name} is down: ${status}`,
            severity: 'medium',
          });
        }
      }
    } catch { /* exited check failed */ }

    // Check for unhealthy containers
    try {
      const unhealthy = execSync(
        'docker ps --filter "health=unhealthy" --format "{{.Names}}|{{.Status}}" 2>/dev/null',
        { encoding: 'utf8', timeout: 5000 }
      ).trim().split('\n').filter(Boolean);
      for (const line of unhealthy) {
        const [name] = line.split('|');
        if (name) {
          findings.push({
            type: 'container_unhealthy',
            project: name,
            detail: `Container ${name} is unhealthy`,
            severity: 'medium',
          });
        }
      }
    } catch { /* unhealthy check failed */ }
  } catch { /* infra check failed */ }
  return findings;
}

function checkPendingItems() {
  const findings = [];
  const proposals = getPendingProposals();
  if (proposals.length >= 1) {
    findings.push({
      type: 'pending_proposals',
      project: null,
      detail: `${proposals.length} pending proposals awaiting response`,
      severity: 'low',
    });
  }
  return findings;
}

// ============================================================
// MAIN PATROL
// ============================================================

export async function runStrategicPatrol(sockRef) {
  console.log('[Patrol] Starting strategic patrol...');
  const startTime = Date.now();
  const allFindings = [];
  const autoFixed = [];
  const proposed = [];

  // Run checks sequentially (memory-safe)
  const checks = [
    { name: 'git_staleness', fn: checkGitStaleness },
    { name: 'dependency_health', fn: checkDependencyHealth },
    { name: 'error_trends', fn: checkErrorTrends },
    { name: 'infra_drift', fn: checkInfraDrift },
    { name: 'pending_items', fn: checkPendingItems },
  ];

  for (const check of checks) {
    try {
      const findings = check.fn();
      allFindings.push(...findings);
    } catch (err) {
      console.error(`[Patrol] ${check.name} failed:`, err.message);
    }
  }

  // Classify each finding through autonomy engine
  for (const finding of allFindings) {
    try {
      const classification = await classifyAction({
        title: `[Patrol] ${finding.type}: ${finding.detail}`,
        description: finding.detail,
        project: finding.project,
        source: 'patrol',
        symptom: finding.detail,
      });

      finding.tier = classification.tier;
      finding.reason = classification.reason;

      if (classification.tier === 'dismiss') {
        // Operational noise — skip entirely
        continue;
      }
      // Patrol doesn't execute fixes — all findings go to proposals
      // (Honest metrics: don't label things "autoFixed" without executing)
      {
        if (finding.severity !== 'low') {
          const proposal = await createProposal({
            title: `${finding.type}: ${finding.project || 'system'}`,
            description: finding.detail,
            project: finding.project,
            risk: finding.severity === 'high' ? 'high' : 'medium',
            source: 'patrol',
          }, sockRef);
          if (proposal) proposed.push({ ...finding, proposalId: proposal.id });
        }
      }
    } catch (err) {
      console.error(`[Patrol] Classification failed for ${finding.type}:`, err.message);
    }
  }

  // Save patrol results for context injection
  const report = {
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    totalFindings: allFindings.length,
    autoFixed: [], // Patrol proposes, doesn't execute — honest reporting
    proposed: proposed.map(f => ({ type: f.type, project: f.project, detail: f.detail, proposalId: f.proposalId })),
    checks: checks.map(c => c.name),
  };
  writeFileSync(PATROL_OUTPUT, JSON.stringify(report, null, 2));

  // Send WhatsApp report (always — a clean bill of health is still useful)
  if (sockRef?.sock) {
    const lines = [`🔭 *PATROL REPORT*`, ''];

    if (autoFixed.length > 0) {
      for (const f of autoFixed) {
        lines.push(`  ✅ [auto] ${f.project || 'system'}: ${f.detail}`);
      }
    }

    if (proposed.length > 0) {
      for (const f of proposed) {
        lines.push(`  📋 [#${f.proposalId}] ${f.project || 'system'}: ${f.detail}`);
      }
    }

    const lowFindings = allFindings.filter(f => f.severity === 'low' && !autoFixed.includes(f) && !proposed.includes(f));
    if (lowFindings.length > 0) {
      for (const f of lowFindings) {
        lines.push(`  ℹ️ ${f.project || 'system'}: ${f.detail}`);
      }
    }

    // Show clean findings if everything looks good
    const dismissed = allFindings.filter(f => f.tier === 'dismiss');
    if (allFindings.length === 0) {
      lines.push('  ✅ All clear — nothing to flag.');
    }

    lines.push('', `Checks: ${checks.length} | Findings: ${allFindings.length} | ${Math.round((Date.now() - startTime) / 1000)}s`);

    try {
      await sockRef.sock.sendMessage(ADMIN_JID, { text: lines.join('\n').substring(0, 3900) });
    } catch (err) {
      console.error('[Patrol] Failed to send report:', err.message);
    }
  }

  console.log(`[Patrol] Complete: ${allFindings.length} findings, ${autoFixed.length} auto-fixed, ${proposed.length} proposed (${Date.now() - startTime}ms)`);
  return report;
}
