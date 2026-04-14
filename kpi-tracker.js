/**
 * KPI Tracker — Daily project health metrics
 *
 * Tracks owned KPIs per project. Missing a threshold = incident.
 * Overlord auto-proposes 3 recovery actions when a KPI drops.
 *
 * Runs: Daily 8 AM AST (12:00 UTC) via scheduler
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { createProposal } from './autonomy-engine.js';

const KPI_PATH = '/app/data/project-kpis.json';
const KPI_HISTORY = '/app/data/kpi-history.jsonl';
const KPI_LATEST = '/app/data/kpi-latest.json';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

/**
 * Collect available metrics for a project.
 * Uses what's available: Cloudflare, container logs, DB queries, git.
 */
function collectMetrics(projectName) {
  const metrics = {};

  // Git-based activity (proxy for development velocity)
  try {
    const path = projectName === 'Overlord' ? '/root/overlord' : `/root/projects/${projectName}`;
    if (existsSync(`${path}/.git`)) {
      const commits = parseInt(execSync(
        `git -C "${path}" log --since="7 days ago" --oneline 2>/dev/null | wc -l`,
        { encoding: 'utf8', timeout: 5000 }
      ).trim()) || 0;
      metrics.commits_week = commits;
    }
  } catch { /* skip */ }

  // Container-based metrics
  try {
    const containerName = projectName.toLowerCase();
    const logs = execSync(
      `docker logs ${containerName} --since 24h 2>&1 | wc -l`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    metrics.log_lines_24h = parseInt(logs) || 0;

    // Try to extract request counts from logs
    const requests = execSync(
      `docker logs ${containerName} --since 24h 2>&1 | grep -c -i "GET\\|POST\\|request" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    metrics.requests_24h = parseInt(requests) || 0;
  } catch { /* container may not exist or no logs */ }

  // Basic availability check
  try {
    const urls = {
      OnlyHulls: 'onlyhulls.com',
      BeastMode: 'beastmode.namibarden.com',
      MasterCommander: 'mastercommander.namibarden.com',
      SurfaBabe: 'surfababe.namibarden.com',
      Lumina: 'lumina.namibarden.com',
      Elmo: 'onlydrafting.com',
    };
    if (urls[projectName]) {
      const code = execSync(
        `curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${urls[projectName]}" 2>/dev/null`,
        { encoding: 'utf8', timeout: 15000 }
      ).trim();
      metrics.http_status = parseInt(code) || 0;
      metrics.is_live = metrics.http_status >= 200 && metrics.http_status < 400;
    }
  } catch { /* skip */ }

  return metrics;
}

/**
 * Run daily KPI check across all projects
 */
export async function runKpiCheck(sockRef) {
  console.log('[KPI] Running daily KPI check...');

  let kpiDefs;
  try {
    kpiDefs = JSON.parse(readFileSync(KPI_PATH, 'utf8'));
  } catch {
    console.error('[KPI] No KPI definitions found');
    return;
  }

  const results = {};
  const incidents = [];

  for (const [projectName, kpis] of Object.entries(kpiDefs)) {
    const metrics = collectMetrics(projectName);

    results[projectName] = {
      metrics,
      timestamp: new Date().toISOString(),
      incidents: [],
    };

    // Check if site is down (critical incident)
    if (metrics.http_status && !metrics.is_live) {
      const incident = {
        project: projectName,
        kpi: 'availability',
        detail: `Site down! HTTP ${metrics.http_status}`,
        severity: 'critical',
      };
      results[projectName].incidents.push(incident);
      incidents.push(incident);
    }

    // Check activity (proxy KPI - no direct analytics yet)
    if (metrics.requests_24h !== undefined && metrics.requests_24h === 0 && metrics.is_live) {
      results[projectName].incidents.push({
        project: projectName,
        kpi: 'activity',
        detail: 'Zero requests in 24h despite site being live',
        severity: 'warning',
      });
    }
  }

  // Save results
  writeFileSync(KPI_LATEST, JSON.stringify(results, null, 2));
  appendFileSync(KPI_HISTORY, JSON.stringify({ timestamp: new Date().toISOString(), results }) + '\n');

  // Create proposals for critical incidents
  for (const incident of incidents) {
    if (incident.severity === 'critical') {
      await createProposal({
        title: `KPI INCIDENT: ${incident.project} — ${incident.detail}`,
        description: `${incident.project} is experiencing a critical KPI failure: ${incident.detail}. Recommend immediate investigation.`,
        project: incident.project,
        risk: 'high',
        source: 'kpi-tracker',
      }, sockRef);
    }
  }

  // Send summary if there are incidents
  if (incidents.length > 0 && sockRef?.sock) {
    const lines = ['📊 *KPI ALERT*', ''];
    for (const inc of incidents) {
      const emoji = inc.severity === 'critical' ? '🔴' : '🟡';
      lines.push(`${emoji} ${inc.project}: ${inc.detail}`);
    }
    try {
      await sockRef.sock.sendMessage(ADMIN_JID, { text: lines.join('\n') });
    } catch (err) {
      console.error('[KPI] Failed to send alert:', err.message);
    }
  }

  console.log(`[KPI] Check complete: ${Object.keys(results).length} projects, ${incidents.length} incidents`);
  return results;
}

/**
 * Get KPI context for prompt injection
 */
export function getKpiContext() {
  try {
    const data = JSON.parse(readFileSync(KPI_LATEST, 'utf8'));
    const lines = [];
    for (const [project, info] of Object.entries(data)) {
      if (info.incidents?.length > 0) {
        lines.push(`${project}: ${info.incidents.map(i => i.detail).join('; ')}`);
      }
    }
    return lines.length > 0 ? `KPI ISSUES: ${lines.join(' | ')}` : '';
  } catch { return ''; }
}
