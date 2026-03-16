#!/usr/bin/env node

/**
 * SessionStart hook: inject relevant memory context.
 * stdin: { session_id }
 * stdout: { systemMessage?: string } or {}
 */

import { buildSessionContext, detectProject } from '../lib/context.mjs';
import { formatCompressionPrompt } from '../lib/compression.mjs';
import { initSchema } from '../lib/schema.mjs';
import { getDb } from '../lib/db.mjs';

function detectActiveProject() {
  // 1. Try CWD
  const cwd = process.cwd();
  const fromCwd = detectProject(cwd);
  if (fromCwd) return fromCwd;

  // 2. Look at most recent tool events to find the active project
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
    const project = detectActiveProject();
    const parts = [];

    const context = buildSessionContext({ project });
    if (context) parts.push(context);

    // Check for stale uncompressed events from previous sessions
    const compression = formatCompressionPrompt({ threshold: 10 });
    if (compression) {
      parts.push(`\nSTALE EVENTS FROM PREVIOUS SESSION: ${compression.eventCount} uncompressed events found. Please compress them before starting new work.\n\n${compression.prompt}`);
    }

    if (parts.length > 0) {
      process.stdout.write(JSON.stringify({ systemMessage: parts.join('\n\n') }));
    } else {
      process.stdout.write('{}');
    }
  } catch (err) {
    process.stderr.write(`memory-v2 inject error: ${err.message}\n`);
    process.stdout.write('{}');
  }
}

main();
