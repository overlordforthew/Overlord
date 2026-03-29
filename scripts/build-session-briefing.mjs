#!/usr/bin/env node

/**
 * Pre-compute session briefing data for the SessionStart hook.
 * Runs via cron every 30 minutes. Output: /root/overlord/data/session-briefing.json
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const DATA_DIR = '/root/overlord/data';
const OUTPUT = `${DATA_DIR}/session-briefing.json`;

// Project dirs to scan for git activity
const PROJECTS = [
  { name: 'Overlord', path: '/root/overlord' },
  { name: 'NamiBarden', path: '/root/projects/NamiBarden' },
  { name: 'MasterCommander', path: '/root/projects/MasterCommander' },
  { name: 'BeastMode', path: '/root/projects/BeastMode' },
  { name: 'Lumina', path: '/root/projects/Lumina' },
  { name: 'SurfaBabe', path: '/root/projects/SurfaBabe' },
  { name: 'Elmo', path: '/root/projects/Elmo' },
  { name: 'OnlyHulls', path: '/root/projects/OnlyHulls' },
];

function getServerSummary() {
  try {
    const status = readFileSync('/root/overlord/STATUS.md', 'utf8');
    const lines = status.split('\n');

    // Extract key stats
    let uptime = '', memory = '', disk = '', load = '';
    for (const line of lines) {
      if (line.includes('**Uptime:**')) uptime = line.replace(/.*\*\*Uptime:\*\*\s*/, '').trim();
      if (line.includes('**Memory:**')) memory = line.replace(/.*\*\*Memory:\*\*\s*/, '').trim();
      if (line.includes('**Disk:**')) disk = line.replace(/.*\*\*Disk:\*\*\s*/, '').trim();
      if (line.includes('**Load:**')) load = line.replace(/.*\*\*Load:\*\*\s*/, '').trim();
    }

    const summary = `${uptime} | RAM ${memory} | Disk ${disk} | Load ${load}`;

    // Find stopped containers
    const issues = [];
    const stoppedSection = status.indexOf('## Stopped Containers');
    if (stoppedSection !== -1) {
      const stoppedLines = status.slice(stoppedSection).split('\n').slice(1);
      for (const sl of stoppedLines) {
        if (sl.startsWith('- ')) issues.push(sl.slice(2).trim());
        if (sl.startsWith('##') && sl !== '## Stopped Containers') break;
      }
    }

    // Count running containers from docker section
    const dockerSection = status.indexOf('## Docker Containers');
    let containerCount = 0;
    if (dockerSection !== -1) {
      const dockerLines = status.slice(dockerSection).split('\n');
      for (const dl of dockerLines) {
        if (dl.includes('Up ') && !dl.startsWith('#') && !dl.startsWith('```')) containerCount++;
      }
    }

    return { summary, issues, containerCount };
  } catch {
    return { summary: 'STATUS.md unavailable', issues: [], containerCount: 0 };
  }
}

function getServiceHealth() {
  try {
    const hb = JSON.parse(readFileSync(`${DATA_DIR}/heartbeat.json`, 'utf8'));
    const unhealthy = [];
    for (const [name, svc] of Object.entries(hb.services || {})) {
      if (svc.status !== 'healthy') {
        unhealthy.push({ name, status: svc.status, failures: svc.consecutiveFailures });
      }
    }
    return unhealthy;
  } catch {
    return [];
  }
}

function getGitActivity() {
  const activity = [];
  let totalCommits = 0;
  const MAX_TOTAL = 10;

  for (const proj of PROJECTS) {
    if (totalCommits >= MAX_TOTAL) break;
    if (!existsSync(`${proj.path}/.git`)) continue;

    try {
      const remaining = MAX_TOTAL - totalCommits;
      const limit = Math.min(3, remaining);
      const raw = execSync(
        `git -C "${proj.path}" log --since="48 hours ago" --oneline --max-count=${limit} --format="%h %s" 2>/dev/null`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();

      if (!raw) continue;

      const commits = raw.split('\n').filter(Boolean);
      totalCommits += commits.length;

      // Get age of most recent commit
      const ageRaw = execSync(
        `git -C "${proj.path}" log -1 --format="%cr" 2>/dev/null`,
        { encoding: 'utf8', timeout: 2000 }
      ).trim();

      activity.push({ project: proj.name, commits, age: ageRaw });
    } catch {
      // Skip repos with errors
    }
  }

  return activity;
}

function getRecentRepairs() {
  try {
    const eventsFile = `${DATA_DIR}/task-events.jsonl`;
    if (!existsSync(eventsFile)) return { repairs: [], stats: { last_48h: 0, all_succeeded: true } };

    const raw = readFileSync(eventsFile, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);

    // Parse last 50 lines to find repair tasks within 48h
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const recent = lines.slice(-50).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);

    // Group by taskId — find completed repair tasks
    const taskMap = new Map();
    for (const evt of recent) {
      if (!taskMap.has(evt.taskId)) taskMap.set(evt.taskId, []);
      taskMap.get(evt.taskId).push(evt);
    }

    const repairs = [];
    let count48h = 0;
    let allSucceeded = true;
    const seenTargets = new Map(); // dedup by target name

    for (const [taskId, events] of taskMap) {
      const created = events.find(e => e.type === 'created');
      const completed = events.find(e => e.type === 'completed');
      if (!created) continue;

      const isRepair = (created.description || '').toLowerCase().includes('repair');
      if (!isRepair) continue;

      const ts = new Date(completed?.at || created.at).getTime();
      if (ts < cutoff) continue;

      count48h++;
      const failed = completed?.error != null;
      if (failed) allSucceeded = false;

      // Dedup: group identical repair targets, keep count
      const target = created.description.replace('Task created: ', '');
      const resultSnippet = completed?.result?.slice(0, 120) || '';
      const result = failed ? 'FAILED' : (resultSnippet.includes('No action needed') || resultSnippet.includes('healthy') ? 'OK' : 'Fixed');

      if (seenTargets.has(target)) {
        const existing = seenTargets.get(target);
        existing.count++;
        if (failed) existing.result = 'FAILED';
      } else {
        const entry = { target, result, age: timeAgo(ts), count: 1 };
        seenTargets.set(target, entry);
        if (repairs.length < 5) repairs.push(entry);
      }
    }

    return { repairs, stats: { last_48h: count48h, all_succeeded: allSucceeded } };
  } catch {
    return { repairs: [], stats: { last_48h: 0, all_succeeded: true } };
  }
}

async function getMemoryHighlights() {
  try {
    // Import from memory-v2 lib
    const { getRecent } = await import('../skills/memory-v2/lib/observations.mjs');
    const { initSchema } = await import('../skills/memory-v2/lib/schema.mjs');
    const { getDb } = await import('../skills/memory-v2/lib/db.mjs');
    initSchema();
    const db = getDb();

    const recent = getRecent({ limit: 5 }).map(o => ({
      id: o.id,
      title: o.title,
      type: o.type,
      project: o.project || 'general',
      outcome: o.outcome || null,
      date: new Date(o.created_at).toISOString().slice(0, 10)
    }));

    const allRecent = getRecent({ limit: 10 });
    const patterns = allRecent
      .filter(o => o.outcome === 'worked')
      .slice(0, 3)
      .map(o => ({
        id: o.id,
        title: o.title,
        project: o.project || 'general'
      }));

    // Standing orders — high-importance episodic memories (rules, preferences, standing orders)
    const standingOrders = db.prepare(`
      SELECT id, title, narrative, importance, jid
      FROM observations
      WHERE status = 'active' AND type = 'episodic' AND importance >= 0.8
      ORDER BY importance DESC, access_count DESC
      LIMIT 10
    `).all().map(o => ({
      id: o.id,
      title: o.title,
      narrative: (o.narrative || '').slice(0, 150),
      importance: o.importance
    }));

    // Recent episodic context — newest per-user facts (decisions, preferences discovered recently)
    const recentEpisodic = db.prepare(`
      SELECT id, title, narrative, importance, jid, tags, created_at
      FROM observations
      WHERE status = 'active' AND type = 'episodic' AND importance < 0.8
      ORDER BY created_at DESC
      LIMIT 8
    `).all().map(o => ({
      id: o.id,
      title: o.title,
      narrative: (o.narrative || '').slice(0, 120),
      importance: o.importance,
      date: new Date(o.created_at).toISOString().slice(0, 10),
      tags: o.tags ? JSON.parse(o.tags) : []
    }));

    // Trending — most accessed in last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const trending = db.prepare(`
      SELECT id, title, type, access_count, project
      FROM observations
      WHERE status = 'active' AND last_accessed > ? AND access_count > 3
      ORDER BY access_count DESC
      LIMIT 5
    `).all(sevenDaysAgo).map(o => ({
      id: o.id,
      title: o.title,
      type: o.type,
      accessCount: o.access_count,
      project: o.project || 'general'
    }));

    // Count total active
    const total = db.prepare("SELECT COUNT(*) as cnt FROM observations WHERE status = 'active'").get().cnt;

    return { recent, patterns, standingOrders, recentEpisodic, trending, totalActive: total };
  } catch (err) {
    console.error('getMemoryHighlights error:', err.message);
    return { recent: [], patterns: [], standingOrders: [], recentEpisodic: [], trending: [], totalActive: 0 };
  }
}

function getTimeContext() {
  const now = new Date();
  // Gil is AST (UTC-4)
  const ast = new Date(now.getTime() - 4 * 60 * 60 * 1000);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const day = days[ast.getUTCDay()];
  const date = ast.toISOString().slice(0, 10);
  const hour = ast.getUTCHours();
  const min = String(ast.getUTCMinutes()).padStart(2, '0');
  const time = `${hour}:${min}`;
  const wakingHours = hour >= 5 && hour < 21;

  return { day, date, time, waking_hours: wakingHours };
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function main() {
  const server = getServerSummary();
  const unhealthyServices = getServiceHealth();
  if (unhealthyServices.length > 0) {
    server.issues.push(...unhealthyServices.map(s => `${s.name}: ${s.status} (${s.failures} failures)`));
  }

  const gitActivity = getGitActivity();
  const { repairs, stats } = getRecentRepairs();
  const memoryHighlights = await getMemoryHighlights();
  const meta = getTimeContext();

  const briefing = {
    generated_at: new Date().toISOString(),
    server: { summary: server.summary, issues: server.issues, containerCount: server.containerCount },
    git_activity: gitActivity,
    recent_repairs: repairs,
    repair_stats: stats,
    memory_highlights: memoryHighlights,
    meta
  };

  writeFileSync(OUTPUT, JSON.stringify(briefing, null, 2));
  console.log(`Session briefing written to ${OUTPUT}`);
}

main().catch(err => {
  console.error('build-session-briefing failed:', err.message);
  process.exit(1);
});
