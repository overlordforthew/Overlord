#!/usr/bin/env node

/**
 * UserPromptSubmit hook: check if compression threshold is met.
 * stdin: { session_id }
 * stdout: { systemMessage?: string } or {}
 */

import { formatCompressionPrompt } from '../lib/compression.mjs';

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
    // Threshold 10 for batch, but on prompt submit we compress if there are any pending
    const result = formatCompressionPrompt({ threshold: 10 });
    if (result) {
      process.stdout.write(JSON.stringify({ systemMessage: result.prompt }));
    } else {
      process.stdout.write('{}');
    }
  } catch (err) {
    process.stderr.write(`memory-v2 compress error: ${err.message}\n`);
    process.stdout.write('{}');
  }
}

main();
