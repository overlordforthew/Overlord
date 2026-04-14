/**
 * Web Intelligence Agent (#1) — Deep research via background agent
 *
 * Spawns a background Claude CLI process that performs multi-page research.
 * Results stored in knowledge base.
 * Trigger: /research <topic> or auto-detected research questions
 */

import { spawn } from 'child_process';
import { spawnWithMemoryLimit, getMemoryLimit } from './work-queue.js';
import { ingest } from './knowledge-base.js';
import pino from 'pino';
import { getIntelligenceBackend, runAgentIntelligence } from './intelligence-runtime.js';

const logger = pino({ level: 'info' });
const CLAUDE_PATH = process.env.CLAUDE_PATH || 'claude';

// Detect messages that would benefit from deep research
const RESEARCH_PATTERNS = /\b(research|investigate|find out|deep dive|analyze the market|competitive analysis|compare .+ options|what are the best|comprehensive look|survey of|report on)\b/i;

export function isResearchRequest(text) {
  if (!text) return false;
  if (text.startsWith('/research ')) return true;
  return RESEARCH_PATTERNS.test(text) && text.length > 30;
}

export function extractResearchTopic(text) {
  if (text.startsWith('/research ')) return text.substring(10).trim();
  return text;
}

/**
 * Run a deep research task in the background.
 * Returns the research result text.
 */
export async function runResearch(topic, timeoutMs = 600_000) {
  const prompt = `You are a research analyst. Conduct thorough research on the following topic.

TOPIC: ${topic}

INSTRUCTIONS:
1. Use WebSearch to find 5-10 relevant sources
2. Use WebFetch to read the most promising pages in full
3. Synthesize findings into a structured brief with:
   - Executive Summary (2-3 sentences)
   - Key Findings (bulleted)
   - Sources Used (with URLs)
   - Recommendations (if applicable)
4. Be thorough but concise. Cite sources.
5. Focus on current, actionable information.

Output your research brief in plain text (no markdown headers, WhatsApp-friendly).`;

  if (getIntelligenceBackend() !== 'claude') {
    const result = await runAgentIntelligence({
      systemPrompt: 'You are a research analyst. Use current sources and produce a concise, actionable brief.',
      userPrompt: prompt,
      cwd: '/tmp',
      timeoutMs,
      role: 'user',
      requestedModel: 'claude-opus-4-6',
      search: true,
    });

    const finalText = result.text || '';
    if (finalText) {
      try {
        await ingest({
          type: 'research',
          title: topic.substring(0, 200),
          content: finalText,
          summary: finalText.substring(0, 500),
          tags: ['research', 'web-intel'],
        });
      } catch { /* best effort */ }
    }
    return finalText;
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const args = [
      '-p', '--output-format', 'json',
      '--max-turns', '30',
      '--model', 'claude-opus-4-6',
      '--allowedTools', 'WebSearch,WebFetch,Read',
    ];

    const safeEnv = {};
    const SAFE_KEYS = ['HOME', 'USER', 'PATH', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'HOSTNAME', 'PWD', 'LOGNAME'];
    for (const k of SAFE_KEYS) { if (process.env[k]) safeEnv[k] = process.env[k]; }
    safeEnv.TERM = 'dumb';
    safeEnv.NODE_OPTIONS = '--max-old-space-size=1024';
    safeEnv.CLAUDE_CODE_MAX_OUTPUT_TOKENS = '16000';
    safeEnv.HOME = process.env.HOME || '/root';
    safeEnv.PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin';

    const proc = spawnWithMemoryLimit(CLAUDE_PATH, args, {
      cwd: '/tmp',
      timeout: timeoutMs,
      env: safeEnv,
    }, getMemoryLimit('complex'));

    proc.stdin.write(prompt);
    proc.stdin.end();

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      if (stdout) {
        try {
          const parsed = JSON.parse(stdout.trim());
          const result = (parsed.result || '').trim() || stdout.trim();

          // Store in knowledge base
          try {
            await ingest({
              type: 'research',
              title: topic.substring(0, 200),
              content: result,
              summary: result.substring(0, 500),
              tags: ['research', 'web-intel'],
            });
          } catch { /* best effort */ }

          resolve(result);
        } catch {
          resolve(stdout.trim());
        }
      } else {
        reject(new Error(`Research failed (code ${code}): ${stderr.substring(0, 300)}`));
      }
    });

    proc.on('error', reject);
  });
}
