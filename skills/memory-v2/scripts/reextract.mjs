#!/usr/bin/env node

/**
 * reextract.mjs — Re-extract knowledge from already-compressed events.
 *
 * Samples the largest sessions, sends them to Gemini for extraction,
 * and stores new observations. Does NOT modify compression status.
 *
 * Usage: node reextract.mjs [--limit 20] [--dry-run]
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { getDb } from '../lib/db.mjs';
import { initSchema } from '../lib/schema.mjs';
import { store } from '../lib/observations.mjs';

const SESSION_LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '20');
const DRY_RUN = process.argv.includes('--dry-run');

const GEMINI_KEY = process.env.GOOGLE_API_KEY || (() => {
  try {
    return JSON.parse(readFileSync(process.env.HOME + '/.config/io.datasette.llm/keys.json', 'utf8')).gemini || '';
  } catch { return ''; }
})();

function log(msg) { console.log(`[reextract] ${msg}`); }

function callGemini(prompt) {
  if (!GEMINI_KEY) throw new Error('No Gemini API key');
  const body = JSON.stringify({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 4096, responseMimeType: 'application/json' },
  });
  const result = execSync(
    `curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}" -H "Content-Type: application/json" -d @-`,
    { timeout: 45000, encoding: 'utf-8', input: body, stdio: ['pipe', 'pipe', 'pipe'] }
  );
  const resp = JSON.parse(result);
  const text = resp?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty Gemini response');
  return text;
}

function sampleSession(db, sessionId) {
  const events = db.prepare(
    'SELECT * FROM tool_events WHERE session_id = ? ORDER BY timestamp ASC'
  ).all(sessionId);

  // Detect project from events
  let project = null;
  const projectCounts = {};
  for (const e of events) {
    if (e.project) {
      projectCounts[e.project] = (projectCounts[e.project] || 0) + 1;
    }
    // Also detect from file paths
    const m = (e.input_summary || '').match(/\/root\/projects\/([^/\s"']+)/);
    if (m) projectCounts[m[1]] = (projectCounts[m[1]] || 0) + 1;
    if ((e.input_summary || '').includes('/root/overlord')) projectCounts['Overlord'] = (projectCounts['Overlord'] || 0) + 1;
  }
  if (Object.keys(projectCounts).length > 0) {
    project = Object.entries(projectCounts).sort((a, b) => b[1] - a[1])[0][0];
  }

  // Tool breakdown
  const tools = {};
  for (const e of events) {
    tools[e.tool_name] = (tools[e.tool_name] || 0) + 1;
  }
  const toolList = Object.entries(tools).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(', ');

  // Sample evenly — up to 40 events
  const sampleSize = Math.min(events.length, 40);
  const step = Math.max(1, Math.floor(events.length / sampleSize));
  const samples = [];
  for (let i = 0; i < events.length && samples.length < sampleSize; i += step) {
    const e = events[i];
    const ts = new Date(e.timestamp).toISOString().slice(0, 16);
    samples.push(`${ts} ${e.tool_name}: ${(e.input_summary || '').slice(0, 120)}`);
  }

  const first = new Date(events[0].timestamp).toISOString().slice(0, 10);
  const last = new Date(events[events.length - 1].timestamp).toISOString().slice(0, 10);

  return { sessionId, project, eventCount: events.length, toolList, samples, dateRange: `${first} to ${last}` };
}

function run() {
  initSchema();
  const db = getDb();

  // Get the largest sessions
  const sessions = db.prepare(`
    SELECT session_id, COUNT(*) as cnt
    FROM tool_events
    GROUP BY session_id
    HAVING cnt >= 20
    ORDER BY cnt DESC
    LIMIT ?
  `).all(SESSION_LIMIT);

  log(`Processing ${sessions.length} sessions`);
  let totalObs = 0;

  for (const { session_id, cnt } of sessions) {
    const info = sampleSession(db, session_id);
    log(`Session ${session_id.slice(0, 8)} | ${info.project || 'unknown'} | ${info.eventCount} events | ${info.dateRange}`);

    const prompt = `You are a memory extraction engine for a server management system. Analyze these tool events from a coding/admin session and extract ACTIONABLE, DURABLE knowledge.

Session: ${info.eventCount} events on project "${info.project || 'unknown'}" (${info.dateRange})
Tools used: ${info.toolList}

Events (${info.eventCount} total, showing ${info.samples.length} sampled):
${info.samples.join('\n')}

Extract 1-5 observations. Focus on:
- DECISIONS made (why was this approach chosen?)
- CONFIGURATIONS changed (what was set up or modified?)
- BUGS FIXED (what broke and how was it fixed?)
- PATTERNS (reusable approaches that worked)
- ARCHITECTURE (how components connect, deploy methods, data flow)

Be SPECIFIC. Include file paths, container names, command patterns, config values.
- BAD: "Server maintenance was performed"
- GOOD: "Traefik dynamic config at /data/coolify/proxy/dynamic/namibarden.yaml is the routing source of truth — project docker-compose files don't control routing"

Return a JSON array. For each observation include the project name if identifiable:
[{"type":"decision|bugfix|pattern|config|discovery","title":"specific title","narrative":"1-3 sentences with concrete details","importance":0.4-0.8,"project":"ProjectName or null"}]

If the events are too generic, return: []`;

    try {
      const raw = callGemini(prompt);
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) { log(`  No JSON found`); continue; }

      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed) || parsed.length === 0) { log(`  Empty extraction`); continue; }

      const observations = parsed
        .filter(o => o.title && o.narrative && o.narrative.length > 30)
        .slice(0, 5);

      for (const o of observations) {
        const obs = {
          type: o.type || 'discovery',
          session_id: session_id,
          title: String(o.title).slice(0, 200),
          narrative: String(o.narrative).slice(0, 500),
          project: o.project || info.project || null,
          source: 'reextract',
          importance: Math.min(0.8, Math.max(0.4, parseFloat(o.importance) || 0.5)),
        };

        if (DRY_RUN) {
          log(`  [dry] ${obs.title} (${obs.importance})`);
        } else {
          const id = store(obs);
          log(`  Stored #${id}: ${obs.title} (${obs.importance})`);
        }
        totalObs++;
      }
    } catch (err) {
      log(`  Error: ${err.message}`);
    }

    // Small delay to avoid Gemini rate limits
    if (!DRY_RUN) {
      execSync('sleep 1');
    }
  }

  log(`Done: ${totalObs} observations from ${sessions.length} sessions`);
  return { sessions: sessions.length, observations: totalObs };
}

const result = run();
console.log(JSON.stringify(result));
