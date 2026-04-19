#!/usr/bin/env node

/**
 * auto-compress.mjs — Compress stale tool events into actionable observations.
 *
 * Groups uncompressed events by session, extracts decisions/patterns/fixes
 * using an LLM, and stores as high-quality observations.
 *
 * Runs on a schedule (every 6h via scheduler.js).
 *
 * Usage: node auto-compress.mjs [--threshold 50] [--dry-run]
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { getDb } from '../lib/db.mjs';
import { initSchema } from '../lib/schema.mjs';
import { store } from '../lib/observations.mjs';
import { markCompressed } from '../lib/events.mjs';

const GEMINI_KEY = process.env.GOOGLE_API_KEY || (() => {
  try {
    return JSON.parse(readFileSync(process.env.HOME + '/.config/io.datasette.llm/keys.json', 'utf8')).gemini || '';
  } catch { return ''; }
})();

const THRESHOLD = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--threshold') || '50');
const DRY_RUN = process.argv.includes('--dry-run');

function log(msg) {
  console.log(`[auto-compress] ${msg}`);
}

function groupEventsBySession(events) {
  const groups = new Map();
  for (const e of events) {
    const sid = e.session_id || 'orphan';
    if (!groups.has(sid)) {
      groups.set(sid, { session_id: sid, project: null, events: [], tools: {} });
    }
    const g = groups.get(sid);
    g.events.push(e);
    if (e.project) g.project = e.project;
    g.tools[e.tool_name] = (g.tools[e.tool_name] || 0) + 1;
  }
  return groups;
}

function buildEventSample(group) {
  // Sample up to 30 events, evenly spaced, with full detail
  const sampleSize = Math.min(group.events.length, 30);
  const step = Math.max(1, Math.floor(group.events.length / sampleSize));
  const samples = [];
  for (let i = 0; i < group.events.length && samples.length < sampleSize; i += step) {
    const e = group.events[i];
    const ts = new Date(e.timestamp).toISOString().slice(11, 19);
    const proj = e.project ? `[${e.project}]` : '';
    samples.push(`${ts} ${proj} ${e.tool_name}: ${(e.input_summary || '').slice(0, 120)}`);
  }
  return samples;
}

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

function tryLlmExtraction(group) {
  const samples = buildEventSample(group);
  const toolList = Object.entries(group.tools)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}(${c})`)
    .join(', ');

  const prompt = `You are a memory extraction engine. Analyze these tool events from a coding session and extract ACTIONABLE knowledge — decisions made, patterns discovered, configurations changed, bugs fixed, architectural choices.

Session: ${group.events.length} events on project "${group.project || 'unknown'}"
Tools used: ${toolList}

Events (${group.events.length} total, showing ${samples.length} sampled):
${samples.join('\n')}

Extract 1-3 observations. Each observation should capture WHAT was done and WHY it matters for future work.

DO NOT write generic summaries like "file reading and debugging". Extract specific, reusable knowledge:
- BAD: "Docker resource management tasks were performed"
- GOOD: "MasterCommander deployment requires docker cp into the running container — Coolify webhook not configured for this project"
- BAD: "Code was edited and tested"
- GOOD: "Fixed memory-v2 db.mjs path detection: /app/data exists on host as stale directory, must check /.dockerenv to distinguish container from host"

Return a JSON array:
[{"type":"decision|bugfix|pattern|config|discovery","title":"specific title","narrative":"1-3 sentences with concrete details","importance":0.4-0.8}]

If the events are too generic to extract meaningful knowledge (e.g., just file browsing with no clear outcome), return: []`;

  try {
    const raw = callGemini(prompt);
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(o => o.title && o.narrative && o.narrative.length > 30)
      .map(o => ({
        type: o.type || 'discovery',
        session_id: group.session_id,
        title: String(o.title).slice(0, 200),
        narrative: String(o.narrative).slice(0, 500),
        project: group.project || null,
        source: 'auto-compress',
        importance: Math.min(0.8, Math.max(0.4, parseFloat(o.importance) || 0.5)),
      }));
  } catch (err) {
    log(`LLM failed for session ${group.session_id.slice(0, 8)}: ${err.message}`);
    return null;
  }
}

function buildFallbackObservation(group) {
  // Extract meaningful file paths and commands
  const files = new Set();
  const commands = [];
  for (const e of group.events) {
    const s = e.input_summary || '';
    const pathMatches = s.match(/\/root\/[^\s,'")\]]+/g);
    if (pathMatches) pathMatches.forEach(f => files.add(f));
    if (e.tool_name === 'Bash' && s.length > 10) commands.push(s.slice(0, 100));
    if (e.tool_name === 'Edit' || e.tool_name === 'Write') files.add(s);
  }

  const toolList = Object.entries(group.tools)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}(${c})`)
    .join(', ');

  const first = new Date(group.events[0].timestamp).toISOString().slice(0, 16);
  const last = new Date(group.events[group.events.length - 1].timestamp).toISOString().slice(0, 16);
  const project = group.project || 'unknown';

  const fileList = [...files].slice(0, 5).join(', ');
  const cmdSample = commands.slice(0, 3).join('; ');

  return {
    type: 'config',
    session_id: group.session_id,
    title: `${project}: ${group.events.length}-event session (${first.slice(5)})`,
    narrative: `Session on ${project} (${first} to ${last}). Tools: ${toolList}.${fileList ? ` Key files: ${fileList}.` : ''}${cmdSample ? ` Commands: ${cmdSample}` : ''}`,
    project: project !== 'unknown' ? project : null,
    source: 'auto-compress-fallback',
    importance: 0.25, // Low — fallback only, real extraction failed
  };
}

function run() {
  initSchema();
  const db = getDb();

  const uncompressed = db.prepare(
    'SELECT * FROM tool_events WHERE compressed = 0 ORDER BY timestamp ASC'
  ).all();

  log(`${uncompressed.length} uncompressed events`);

  if (uncompressed.length < THRESHOLD) {
    log(`Below threshold (${THRESHOLD}), skipping`);
    return { compressed: 0, observations: 0 };
  }

  const groups = groupEventsBySession(uncompressed);
  let obsCount = 0;
  let lastEventId = 0;
  const smallEvents = [];

  for (const [sid, group] of groups) {
    if (group.events.length < 5) {
      smallEvents.push(...group.events);
      continue;
    }

    // Rate limit: 4s between Gemini calls (free tier = 20 RPM)
    if (obsCount > 0 || lastEventId > 0) execSync('sleep 4');

    // Try LLM extraction first
    const extracted = tryLlmExtraction(group);

    if (extracted === null || extracted.length === 0) {
      // LLM failed or found nothing extractable — store minimal fallback
      const fallback = buildFallbackObservation(group);
      if (DRY_RUN) {
        log(`[dry-run] Fallback: ${fallback.title}`);
      } else {
        const id = store(fallback);
        log(`Stored fallback #${id}: ${fallback.title}`);
        obsCount++;
      }
    } else {
      // Store each extracted observation
      for (const obs of extracted) {
        if (DRY_RUN) {
          log(`[dry-run] Would store: ${obs.title} (importance: ${obs.importance})`);
        } else {
          const id = store(obs);
          log(`Stored #${id}: ${obs.title} (importance: ${obs.importance})`);
          obsCount++;
        }
      }
    }

    const maxId = Math.max(...group.events.map(e => e.id));
    if (maxId > lastEventId) lastEventId = maxId;
  }

  // Batch small sessions — these are too short for meaningful extraction
  if (smallEvents.length > 0) {
    const maxId = Math.max(...smallEvents.map(e => e.id));
    if (maxId > lastEventId) lastEventId = maxId;
    log(`Skipping ${smallEvents.length} events from short sessions (<5 events) — no meaningful extraction possible`);
  }

  // Mark all as compressed
  if (!DRY_RUN && lastEventId > 0) {
    const result = markCompressed(lastEventId);
    log(`Marked ${result.changes} events as compressed`);
  }

  const result = { compressed: uncompressed.length, observations: obsCount };
  log(`Done: ${result.observations} observations from ${result.compressed} events`);
  return result;
}

const result = run();
if (!DRY_RUN) {
  console.log(JSON.stringify(result));
}
