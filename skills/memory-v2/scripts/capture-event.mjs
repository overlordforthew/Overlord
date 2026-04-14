#!/usr/bin/env node

/**
 * PostToolUse hook: capture tool events into SQLite.
 * stdin: { tool_name, tool_input, session_id }
 * stdout: {} (silent)
 */

import { insertEvent } from '../lib/events.mjs';
import { writeFileSync, readFileSync } from 'fs';

const CLI_ACTIVITY_PATH = '/root/overlord/data/cli-activity.json';

function detectProject(input) {
  if (!input) return null;
  const str = typeof input === 'string' ? input : JSON.stringify(input);
  const match = str.match(/\/root\/projects\/([^/\s"']+)/);
  if (match) return match[1];
  if (str.includes('/root/overlord')) return 'Overlord';
  return null;
}

function summarizeInput(toolName, input) {
  if (!input) return null;
  if (typeof input === 'string') return input.slice(0, 200);

  switch (toolName) {
    case 'Read':
      return input.file_path || null;
    case 'Write':
      return input.file_path || null;
    case 'Edit':
      return input.file_path || null;
    case 'Glob':
      return `${input.pattern || ''} in ${input.path || 'cwd'}`;
    case 'Grep':
      return `/${input.pattern || ''}/ in ${input.path || 'cwd'}`;
    case 'Bash':
      return (input.command || '').slice(0, 200);
    case 'WebFetch':
    case 'WebSearch':
      return input.url || input.query || null;
    default:
      return JSON.stringify(input).slice(0, 200);
  }
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

  const { tool_name, tool_input, session_id } = data;
  if (!tool_name || !session_id) {
    process.stdout.write('{}');
    return;
  }

  try {
    const project = detectProject(tool_input);
    const input_summary = summarizeInput(tool_name, tool_input);

    insertEvent({
      session_id,
      project,
      tool_name,
      input_summary,
      output_size: null
    });

    // Write rolling CLI activity for WhatsApp bridge awareness
    try {
      let recent = [];
      try { recent = JSON.parse(readFileSync(CLI_ACTIVITY_PATH, 'utf8')); } catch { /* fresh */ }
      recent.push({ tool: tool_name, summary: input_summary, project, ts: Date.now() });
      if (recent.length > 15) recent = recent.slice(-15);
      writeFileSync(CLI_ACTIVITY_PATH, JSON.stringify(recent));
    } catch { /* non-critical */ }
  } catch (err) {
    // Silently fail — hooks should never block
    process.stderr.write(`memory-v2 capture error: ${err.message}\n`);
  }

  process.stdout.write('{}');
}

main();
