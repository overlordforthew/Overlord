#!/usr/bin/env node

/**
 * auto-compress.mjs — Programmatic compression of stale tool events.
 *
 * Groups uncompressed events by session, generates summary observations
 * using a free LLM model, and marks events as compressed.
 *
 * Runs on a schedule (every 6h via scheduler.js) to prevent event pileup
 * from autonomous sessions that don't trigger the Claude-prompted flow.
 *
 * Usage: node auto-compress.mjs [--threshold 50] [--dry-run]
 */

import { execSync } from 'child_process';
import { getDb } from '../lib/db.mjs';
import { initSchema } from '../lib/schema.mjs';
import { store } from '../lib/observations.mjs';
import { markCompressed } from '../lib/events.mjs';

const THRESHOLD = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--threshold') || '50');
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_LLM_ATTEMPTS = 3;
let llmFailCount = 0;

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

function buildRuleSummary(group) {
  const toolList = Object.entries(group.tools)
    .sort((a, b) => b[1] - a[1])
    .map(([t, c]) => `${t}(${c})`)
    .join(', ');

  const first = new Date(group.events[0].timestamp).toISOString().slice(0, 16);
  const last = new Date(group.events[group.events.length - 1].timestamp).toISOString().slice(0, 16);
  const project = group.project || 'unknown';

  // Extract unique file paths from input summaries
  const files = new Set();
  for (const e of group.events) {
    const s = e.input_summary || '';
    const matches = s.match(/\/root\/[^\s,'")\]]+/g);
    if (matches) matches.forEach(f => files.add(f));
  }

  return {
    type: 'config',
    session_id: group.session_id,
    title: `Auto-compressed: ${project} session (${group.events.length} events)`,
    narrative: `Autonomous session ${group.session_id.slice(0, 8)} on ${project}. Tools: ${toolList}. Time: ${first} to ${last}.`,
    facts: [
      `${group.events.length} tool events`,
      `Tools: ${toolList}`,
      `Time range: ${first} to ${last}`,
    ],
    concepts: ['auto-compressed', project.toLowerCase()],
    files_modified: [...files].slice(0, 10),
    project: project !== 'unknown' ? project : null,
    source: 'auto-compress',
    importance: 0.3,
  };
}

function tryLlmSummary(group) {
  // Skip LLM if we've already failed or exceeded max attempts
  if (llmFailCount >= MAX_LLM_ATTEMPTS) {
    return null;
  }

  const sampleSize = Math.min(group.events.length, 20);
  const step = Math.max(1, Math.floor(group.events.length / sampleSize));
  const samples = [];
  for (let i = 0; i < group.events.length && samples.length < sampleSize; i += step) {
    const e = group.events[i];
    const ts = new Date(e.timestamp).toISOString().slice(11, 19);
    samples.push(`${ts} ${e.tool_name}: ${(e.input_summary || '').slice(0, 80)}`);
  }

  const prompt = `Summarize these tool events from an autonomous coding session into a JSON object. Be concise.

Events (${group.events.length} total, showing ${samples.length}):
${samples.join('\n')}

Project: ${group.project || 'unknown'}

Return ONLY valid JSON:
{"type":"config|bugfix|feature|discovery","title":"short title","narrative":"1-2 sentence summary","facts":["fact1","fact2"],"concepts":["concept1"]}`;

  try {
    const result = execSync(
      'llm -m openrouter/openrouter/free',
      { timeout: 20000, encoding: 'utf-8', input: prompt }
    );

    // Extract JSON from response (may have markdown fences)
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.title || !parsed.narrative) return null;

    return {
      type: parsed.type || 'config',
      session_id: group.session_id,
      title: parsed.title.slice(0, 200),
      narrative: parsed.narrative.slice(0, 500),
      facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 5) : [],
      concepts: Array.isArray(parsed.concepts) ? parsed.concepts.slice(0, 5) : [],
      project: group.project || null,
      source: 'auto-compress-llm',
      importance: 0.35,
    };
  } catch (err) {
    llmFailCount++;
    const skipMsg = llmFailCount >= MAX_LLM_ATTEMPTS ? ' — skipping LLM for remaining groups' : '';
    log(`LLM failed (${llmFailCount}/${MAX_LLM_ATTEMPTS}) for session ${group.session_id.slice(0, 8)}: ${err.message}${skipMsg}`);
    return null;
  }
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

  // Process sessions with 5+ events individually, batch the rest
  const smallEvents = [];

  for (const [sid, group] of groups) {
    if (group.events.length < 5) {
      smallEvents.push(...group.events);
      continue;
    }

    // Try LLM first, fall back to rule-based
    let obs = tryLlmSummary(group);
    if (!obs) obs = buildRuleSummary(group);

    if (DRY_RUN) {
      log(`[dry-run] Would store: ${obs.title}`);
    } else {
      const id = store(obs);
      log(`Stored #${id}: ${obs.title}`);
      obsCount++;
    }

    const maxId = Math.max(...group.events.map(e => e.id));
    if (maxId > lastEventId) lastEventId = maxId;
  }

  // Batch small sessions into one observation
  if (smallEvents.length > 0) {
    const toolCounts = {};
    for (const e of smallEvents) {
      toolCounts[e.tool_name] = (toolCounts[e.tool_name] || 0) + 1;
    }
    const toolList = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => `${t}(${c})`).join(', ');
    const sessionCount = new Set(smallEvents.map(e => e.session_id)).size;

    const batchObs = {
      type: 'config',
      title: `Auto-compressed: ${sessionCount} small sessions (${smallEvents.length} events)`,
      narrative: `Batch of ${sessionCount} short autonomous sessions with <5 events each. Tools: ${toolList}.`,
      facts: [`${smallEvents.length} events across ${sessionCount} sessions`, `Tools: ${toolList}`],
      concepts: ['auto-compressed', 'batch'],
      source: 'auto-compress',
      importance: 0.2,
    };

    if (DRY_RUN) {
      log(`[dry-run] Would store batch: ${batchObs.title}`);
    } else {
      const id = store(batchObs);
      log(`Stored #${id}: ${batchObs.title}`);
      obsCount++;
    }

    const maxId = Math.max(...smallEvents.map(e => e.id));
    if (maxId > lastEventId) lastEventId = maxId;
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
  // Output JSON for scheduler to parse
  console.log(JSON.stringify(result));
}
