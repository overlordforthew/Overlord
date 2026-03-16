#!/usr/bin/env node

/**
 * SessionStart hook: inject relevant memory context.
 * stdin: { session_id }
 * stdout: { systemMessage?: string } or {}
 */

import { buildSessionContext, detectProject } from '../lib/context.mjs';

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
    // Detect project from CWD
    const cwd = process.cwd();
    const project = detectProject(cwd);

    const context = buildSessionContext({ project });
    if (context) {
      process.stdout.write(JSON.stringify({ systemMessage: context }));
    } else {
      process.stdout.write('{}');
    }
  } catch (err) {
    process.stderr.write(`memory-v2 inject error: ${err.message}\n`);
    process.stdout.write('{}');
  }
}

main();
