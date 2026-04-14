/**
 * Portfolio Scorecard — Weekly Monday memo
 *
 * Scores each project on business metrics, forces a hard recommendation:
 *   DOUBLE DOWN / MAINTAIN / WATCH / SUNSET CANDIDATE
 *
 * Pulls from: git activity, container health, Cloudflare analytics,
 *             error rates, conversation volume, dependency health.
 *
 * Runs: Monday 9 AM AST (13:00 UTC) via scheduler
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'fs';

const SCORECARD_PATH = '/app/data/scorecard-latest.json';

// Cloudflare zone IDs for analytics
const CF_ZONES = {
  'namibarden.com': '51ea8958dc949e1793c0d31435cfa699',
  'onlyhulls.com': '3d950be33832c344c40e7bd75a5c7ac2',
  'onlydrafting.com': '5a4473673d3df140fa184e36f8567031',
};
const SCORECARD_HISTORY = '/app/data/scorecard-history.jsonl';
const KPI_PATH = '/app/data/project-kpis.json';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

// Projects to score (NamiBarden excluded per constitution)
const PROJECTS = [
  { name: 'OnlyHulls', path: '/root/projects/OnlyHulls', url: 'onlyhulls.com', deploy: 'coolify' },
  { name: 'BeastMode', path: '/root/projects/BeastMode', url: 'beastmode.namibarden.com', deploy: 'coolify' },
  { name: 'MasterCommander', path: '/root/projects/MasterCommander', url: 'mastercommander.namibarden.com', deploy: 'docker-cp' },
  { name: 'SurfaBabe', path: '/root/projects/SurfaBabe', url: 'surfababe.namibarden.com', deploy: 'webhook' },
  { name: 'Lumina', path: '/root/projects/Lumina', url: 'lumina.namibarden.com', deploy: 'coolify' },
  { name: 'Elmo', path: '/root/projects/Elmo', url: 'onlydrafting.com', deploy: 'coolify' },
];

// ============================================================
// SCORING FUNCTIONS
// ============================================================

function scoreCloudflareTraffic(url) {
  const domain = url.replace(/^www\./, '');
  const zoneId = CF_ZONES[domain];
  if (!zoneId) return { score: -1, detail: 'No Cloudflare zone', source: 'not_available' };

  const cfToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!cfToken) return { score: -1, detail: 'No CF token', source: 'not_configured' };

  try {
    // GraphQL analytics for last 7 days
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const until = new Date().toISOString().split('T')[0];
    const query = JSON.stringify({
      query: `{ viewer { zones(filter: {zoneTag: "${zoneId}"}) { httpRequests1dGroups(limit: 7, filter: {date_geq: "${since}", date_leq: "${until}"}) { sum { requests pageViews } } } } }`
    });

    const result = execSync(
      `curl -s -X POST "https://api.cloudflare.com/client/v4/graphql" -H "Authorization: Bearer ${cfToken}" -H "Content-Type: application/json" -d '${query}'`,
      { encoding: 'utf8', timeout: 15000 }
    );
    const data = JSON.parse(result);
    const groups = data?.data?.viewer?.zones?.[0]?.httpRequests1dGroups || [];
    const totalRequests = groups.reduce((s, g) => s + (g.sum?.requests || 0), 0);
    const totalPageViews = groups.reduce((s, g) => s + (g.sum?.pageViews || 0), 0);

    // Score: 0 pv = 0, 1-50 = 30, 50-200 = 50, 200-1000 = 70, 1000+ = 90
    const score = totalPageViews === 0 ? 0 : totalPageViews < 50 ? 30 : totalPageViews < 200 ? 50 : totalPageViews < 1000 ? 70 : 90;
    return { score, detail: `${totalPageViews} page views, ${totalRequests} requests (7d)`, source: 'cloudflare_analytics' };
  } catch (err) {
    return { score: -1, detail: `CF analytics failed: ${err.message}`, source: 'cloudflare_error' };
  }
}

function scoreGitActivity(projectPath) {
  try {
    if (!existsSync(`${projectPath}/.git`)) return { score: 0, detail: 'No git repo', source: 'filesystem check' };
    const weekCommits = execSync(
      `git -C "${projectPath}" log --since="7 days ago" --oneline 2>/dev/null | wc -l`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    const count = parseInt(weekCommits) || 0;
    const lastCommit = execSync(
      `git -C "${projectPath}" log -1 --format="%ar" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    // 0 commits = 0, 1-2 = 40, 3-5 = 60, 6-10 = 80, 10+ = 100
    const score = count === 0 ? 0 : count <= 2 ? 40 : count <= 5 ? 60 : count <= 10 ? 80 : 100;
    return { score, detail: `${count} commits this week (last: ${lastCommit})`, source: 'git log' };
  } catch { return { score: 0, detail: 'Git check failed' }; }
}

function scoreContainerHealth(projectName) {
  try {
    const status = execSync(
      `docker ps --filter "name=${projectName.toLowerCase()}" --format "{{.Status}}" 2>/dev/null`,
      { encoding: 'utf8', timeout: 5000 }
    ).trim();
    if (!status) return { score: 0, detail: 'Container not found' };
    if (/Up/.test(status) && !/Restarting/.test(status)) {
      return { score: 100, detail: `Healthy: ${status}`, source: 'docker ps' };
    }
    return { score: 30, detail: `Unhealthy: ${status}` };
  } catch { return { score: 50, detail: 'Container check failed' }; }
}

function scoreErrorRate(projectName) {
  try {
    const frictionPath = '/app/data/meta-learning/friction.json';
    if (!existsSync(frictionPath)) return { score: 80, detail: 'No friction data' };
    const friction = JSON.parse(readFileSync(frictionPath, 'utf8'));
    const projectErrors = (friction.events || []).filter(e => {
      const age = Date.now() - new Date(e.ts || e.timestamp).getTime();
      return age < 7 * 24 * 60 * 60 * 1000 && // last 7 days
        (e.project === projectName || e.context?.includes(projectName));
    });
    const count = projectErrors.length;
    const score = count === 0 ? 100 : count <= 2 ? 70 : count <= 5 ? 40 : 10;
    return { score, detail: `${count} errors this week`, source: 'friction.json' };
  } catch { return { score: 80, detail: 'Error check failed' }; }
}

function scoreDependencyHealth(projectPath) {
  try {
    if (!existsSync(`${projectPath}/package.json`)) return { score: 70, detail: 'No package.json' };
    const audit = execSync(
      `cd "${projectPath}" && npm audit --json 2>/dev/null | head -c 2000`,
      { encoding: 'utf8', timeout: 30000 }
    );
    const data = JSON.parse(audit);
    const vulns = data.metadata?.vulnerabilities || {};
    const critical = (vulns.critical || 0) + (vulns.high || 0);
    const score = critical === 0 ? 100 : critical <= 2 ? 60 : 20;
    return { score, detail: `${critical} critical/high vulns`, source: 'npm audit' };
  } catch { return { score: 70, detail: 'Audit failed' }; }
}

function scoreReachability(url) {
  try {
    const status = execSync(
      `curl -s -o /dev/null -w "%{http_code}" --max-time 10 "https://${url}" 2>/dev/null`,
      { encoding: 'utf8', timeout: 15000 }
    ).trim();
    const code = parseInt(status);
    if (code >= 200 && code < 400) return { score: 100, detail: `HTTP ${code}` };
    if (code >= 400 && code < 500) return { score: 50, detail: `HTTP ${code}` };
    return { score: 10, detail: `HTTP ${code}` };
  } catch { return { score: 0, detail: 'Unreachable' }; }
}

// ============================================================
// MAIN SCORECARD
// ============================================================

export async function generateScorecard(sockRef) {
  console.log('[Scorecard] Generating portfolio scorecard...');
  const results = [];

  for (const project of PROJECTS) {
    const scores = {
      git: scoreGitActivity(project.path),
      health: scoreContainerHealth(project.name),
      errors: scoreErrorRate(project.name),
      deps: scoreDependencyHealth(project.path),
      reachability: scoreReachability(project.url),
      traffic: scoreCloudflareTraffic(project.url),
    };

    // Weighted composite: traffic 25%, git 20%, health 20%, errors 15%, deps 10%, reachability 10%
    // If CF traffic not available, fall back to original weights
    const hasTraffic = scores.traffic.score >= 0;
    const composite = hasTraffic
      ? Math.round(
          scores.traffic.score * 0.25 +
          scores.git.score * 0.20 +
          scores.health.score * 0.20 +
          scores.errors.score * 0.15 +
          scores.deps.score * 0.10 +
          scores.reachability.score * 0.10
        )
      : Math.round(
          scores.git.score * 0.30 +
          scores.health.score * 0.25 +
          scores.errors.score * 0.20 +
          scores.deps.score * 0.10 +
          scores.reachability.score * 0.15
        );

    // Recommendation
    let recommendation;
    if (composite >= 75) recommendation = 'DOUBLE DOWN';
    else if (composite >= 50) recommendation = 'MAINTAIN';
    else if (composite >= 25) recommendation = 'WATCH';
    else recommendation = 'SUNSET CANDIDATE';

    results.push({
      name: project.name,
      url: project.url,
      composite,
      recommendation,
      scores,
    });
  }

  // Sort by composite score descending
  results.sort((a, b) => b.composite - a.composite);

  // Save scorecard
  const scorecard = {
    timestamp: new Date().toISOString(),
    week: getWeekString(),
    projects: results,
  };
  writeFileSync(SCORECARD_PATH, JSON.stringify(scorecard, null, 2));
  appendFileSync(SCORECARD_HISTORY, JSON.stringify(scorecard) + '\n');

  // Format WhatsApp memo
  const memo = formatMemo(results);

  // Send to Gil
  if (sockRef?.sock) {
    try {
      await sockRef.sock.sendMessage(ADMIN_JID, { text: memo });
      console.log('[Scorecard] Monday memo sent');
    } catch (err) {
      console.error('[Scorecard] Failed to send memo:', err.message);
    }
  }

  console.log(`[Scorecard] Complete: ${results.length} projects scored`);
  return scorecard;
}

function formatMemo(results) {
  const week = getWeekString();
  const lines = [`PORTFOLIO MEMO — ${week}`, ''];

  for (const r of results) {
    const emoji = {
      'DOUBLE DOWN': '🚀',
      'MAINTAIN': '✅',
      'WATCH': '👀',
      'SUNSET CANDIDATE': '🌅',
    }[r.recommendation] || '❓';

    lines.push(`${emoji} *${r.recommendation}:* ${r.name} (${r.composite}/100)`);
    // Top detail line
    const topIssue = Object.entries(r.scores)
      .sort((a, b) => a[1].score - b[1].score)[0];
    if (topIssue[1].score < 70) {
      lines.push(`   ⚠️ ${topIssue[0]}: ${topIssue[1].detail}`);
    } else {
      lines.push(`   ${r.scores.git.detail}`);
    }
  }

  lines.push('');
  lines.push(`Scored on: git activity, container health, errors, deps, reachability`);
  return lines.join('\n');
}

function getWeekString() {
  const now = new Date();
  return `Week of ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

/**
 * Get latest scorecard for context injection
 */
export function getLatestScorecard() {
  try {
    return JSON.parse(readFileSync(SCORECARD_PATH, 'utf8'));
  } catch { return null; }
}
