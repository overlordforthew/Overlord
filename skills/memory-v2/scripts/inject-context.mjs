#!/usr/bin/env node

/**
 * SessionStart hook: inject Overlord personality + situational briefing.
 * Reads pre-computed session-briefing.json (built by cron every 30min).
 * Falls back to inline buildSessionContext() if briefing is stale (>2h).
 * stdin: { session_id }
 * stdout: { systemMessage?: string } or {}
 */

import { readFileSync, writeFileSync, appendFileSync, statSync, mkdirSync } from 'fs';
import { buildSessionContext, detectProject } from '../lib/context.mjs';
import { initSchema } from '../lib/schema.mjs';
import { getDb } from '../lib/db.mjs';

const BRIEFING_PATH = '/root/overlord/data/session-briefing.json';
const INJECTION_LOG = '/root/overlord/data/briefing-injections.jsonl';
const MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

function detectActiveProject() {
  const cwd = process.cwd();
  const fromCwd = detectProject(cwd);
  if (fromCwd) return fromCwd;

  try {
    initSchema();
    const db = getDb();
    const row = db.prepare(`
      SELECT project FROM tool_events
      WHERE project IS NOT NULL
      ORDER BY timestamp DESC LIMIT 1
    `).get();
    if (row) return row.project;
  } catch { /* fall through */ }

  return null;
}

function loadBriefing() {
  try {
    const stat = statSync(BRIEFING_PATH);
    const age = Date.now() - stat.mtimeMs;
    if (age > MAX_AGE_MS) return null; // stale

    return JSON.parse(readFileSync(BRIEFING_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function formatBriefing(briefing, project) {
  const s = briefing.server || {};
  const meta = briefing.meta || {};
  const lines = [];

  lines.push(`OVERLORD — SESSION BRIEFING`);
  lines.push(`You are Overlord — the AI running Gil's entire digital operation. Sharp, direct,`);
  lines.push(`dry humor, opinionated. The ship's AI, not a help desk. See /root/overlord/IDENTITY.md.`);
  lines.push(``);
  lines.push(`On your FIRST response, greet Gil with a concise situational briefing. Highlight`);
  lines.push(`what matters — don't dump everything. If all's quiet, just check in briefly.`);
  lines.push(`You know him. You've been here. Act like it.`);
  lines.push(``);

  // Server
  lines.push(`SERVER: ${s.summary || 'unknown'} | ${s.containerCount || '?'} containers`);
  if (s.issues && s.issues.length > 0) {
    lines.push(`ISSUES: ${s.issues.join('; ')}`);
  }
  lines.push(``);

  // Git activity
  const git = briefing.git_activity || [];
  if (git.length > 0) {
    lines.push(`ACTIVITY (last 48h):`);
    for (const proj of git) {
      lines.push(`  ${proj.project} (${proj.age}):`);
      for (const c of proj.commits) {
        lines.push(`    ${c}`);
      }
    }
    lines.push(``);
  }

  // Repairs (deduped)
  const repairs = briefing.recent_repairs || [];
  const repairStats = briefing.repair_stats || {};
  if (repairs.length > 0) {
    const status = repairStats.all_succeeded ? 'all resolved' : 'some failed';
    lines.push(`AUTO-REPAIRS (${repairStats.last_48h} in 48h, ${status}):`);
    for (const r of repairs) {
      const countSuffix = r.count > 1 ? ` (×${r.count})` : '';
      lines.push(`  ${r.target} → ${r.result} (${r.age})${countSuffix}`);
    }
    lines.push(``);
  }

  // Standing orders & rules (high-importance episodic memories)
  const standingOrders = briefing.memory_highlights?.standingOrders || [];
  if (standingOrders.length > 0) {
    lines.push(`STANDING ORDERS:`);
    for (const o of standingOrders) {
      lines.push(`  • ${o.narrative || o.title}`);
    }
    lines.push(``);
  }

  // Current project context
  if (project) {
    const mem = briefing.memory_highlights || {};
    const projectObs = (mem.recent || []).filter(o => o.project === project);
    if (projectObs.length > 0) {
      lines.push(`CURRENT PROJECT (${project}):`);
      for (const o of projectObs) {
        const outcome = o.outcome ? ` [${o.outcome}]` : '';
        lines.push(`  #${o.id} ${o.title} (${o.type}, ${o.date})${outcome}`);
      }
      lines.push(``);
    }
  }

  // Recent episodic context (decisions, preferences, facts learned recently)
  const recentEpisodic = briefing.memory_highlights?.recentEpisodic || [];
  if (recentEpisodic.length > 0) {
    lines.push(`RECENT CONTEXT:`);
    for (const e of recentEpisodic) {
      const tagStr = e.tags?.length ? ` [${e.tags[0]}]` : '';
      lines.push(`  • ${e.narrative || e.title}${tagStr} (${e.date})`);
    }
    lines.push(``);
  }

  // Trending — frequently accessed observations
  const trending = briefing.memory_highlights?.trending || [];
  if (trending.length > 0) {
    lines.push(`TRENDING (frequently accessed):`);
    for (const t of trending) {
      lines.push(`  #${t.id} ${t.title} [${t.type}/${t.project}] (${t.accessCount} hits)`);
    }
    lines.push(``);
  }

  // Cross-project patterns
  const patterns = (briefing.memory_highlights?.patterns || []);
  if (patterns.length > 0) {
    lines.push(`PATTERNS THAT WORKED:`);
    for (const p of patterns) {
      lines.push(`  #${p.id} [${p.project}] ${p.title}`);
    }
    lines.push(``);
  }

  // Memory + time
  const totalObs = briefing.memory_highlights?.totalActive || 0;
  if (totalObs > 0) {
    lines.push(`MEMORY: ${totalObs} active observations. \`mem search <query>\` for details.`);
  }
  lines.push(`TIME: ${meta.day}, ${meta.date} ${meta.time} AST${meta.waking_hours ? '' : ' (outside waking hours)'}`);

  return lines.join('\n');
}

function logInjection(sessionId, briefing, project, tokenEstimate) {
  try {
    const entry = {
      session_id: sessionId || null,
      at: new Date().toISOString(),
      project: project || null,
      token_estimate: tokenEstimate,
      sections: {
        server: !!(briefing?.server?.summary),
        issues: (briefing?.server?.issues?.length || 0) > 0,
        git_activity: (briefing?.git_activity || []).map(g => g.project),
        repairs: (briefing?.recent_repairs?.length || 0),
        memory_recent: (briefing?.memory_highlights?.recent?.length || 0),
        memory_patterns: (briefing?.memory_highlights?.patterns?.length || 0),
      },
      briefing_age_min: briefing?.generated_at
        ? Math.round((Date.now() - new Date(briefing.generated_at).getTime()) / 60000)
        : null,
      fallback: !briefing,
    };
    appendFileSync(INJECTION_LOG, JSON.stringify(entry) + '\n');
  } catch { /* never fail the hook for logging */ }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    process.stdout.write('{}');
    return;
  }

  try {
    const sessionId = data.session_id || null;
    const project = detectActiveProject();
    const briefing = loadBriefing();

    let systemMessage;

    if (briefing) {
      systemMessage = formatBriefing(briefing, project);
    } else {
      const context = buildSessionContext({ project });
      if (context) {
        systemMessage = `OVERLORD — SESSION BRIEFING
You are Overlord — the AI running Gil's entire digital operation. Sharp, direct,
dry humor, opinionated. The ship's AI, not a help desk. See /root/overlord/IDENTITY.md.

On your FIRST response, greet Gil briefly. Briefing data was stale — check STATUS.md if needed.

${context}`;
      }
    }

    // Log what we injected for effectiveness analysis
    if (systemMessage) {
      const tokenEstimate = Math.ceil(systemMessage.length / 4);
      logInjection(sessionId, briefing, project, tokenEstimate);
    }

    // Auto-compress stale events silently
    try {
      const db = getDb();
      const stale = db.prepare('SELECT COUNT(*) as c FROM tool_events WHERE compressed = 0').get();
      if (stale.c > 50) {
        db.prepare('UPDATE tool_events SET compressed = 1 WHERE compressed = 0').run();
      }
    } catch { /* silent */ }

    if (systemMessage) {
      process.stdout.write(JSON.stringify({ systemMessage }));
    } else {
      process.stdout.write('{}');
    }
  } catch (err) {
    process.stderr.write(`memory-v2 inject error: ${err.message}\n`);
    process.stdout.write('{}');
  }
}

main();
