/**
 * Incident Postmortem Generator — Auto-generate structured postmortems
 *
 * After any repair/fix task completes, generates a postmortem with:
 * timeline, root cause, fix applied, prevention steps.
 * Stores in knowledge base for institutional memory.
 * /postmortems command to search/list.
 */

import { callWithFallback } from './router.js';
import { parseJsonFromLLM } from './lib/parse-json-llm.js';
import { ingest, search as kbSearch } from './knowledge-base.js';
import { getTaskEvents } from './task-store.js';
import pino from 'pino';

const logger = pino({ level: 'info' });

/**
 * Generate a postmortem from a completed repair task.
 * Uses Step Flash (free) to synthesize structured analysis.
 */
export async function generatePostmortem(task, responseText) {
  if (!task || !responseText || responseText.length < 50) return null;

  // Gather task timeline from events
  let timeline = '';
  try {
    const events = await getTaskEvents(task.id, 20);
    if (events.length > 0) {
      timeline = events.map(e => {
        const time = new Date(e.at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        return `${time} — [${e.type}] ${e.description}`;
      }).join('\n');
    }
  } catch { /* best effort */ }

  const prompt = `Generate a concise incident postmortem from this repair task. Return ONLY valid JSON:
{
  "title": "short incident title (5-10 words)",
  "severity": "P0|P1|P2|P3",
  "timeline": "what happened in chronological order (2-4 bullet points)",
  "rootCause": "the actual root cause (1-2 sentences)",
  "fix": "what was done to fix it (1-2 sentences)",
  "impact": "what was affected and for how long (1 sentence)",
  "prevention": "how to prevent this from happening again (1-2 bullet points)",
  "tags": ["tag1", "tag2"]
}

Task: ${task.title}
Project: ${task.project || 'unknown'}
Kind: ${task.kind}
Source: ${task.source || 'unknown'}

${timeline ? `Event Timeline:\n${timeline}\n` : ''}
Resolution:\n${responseText.substring(0, 1500)}`;

  try {
    const { response: result } = await callWithFallback(
      ['gemini-flash', 'gemini-flash-lite'],
      'You generate structured incident postmortems from repair logs. Return ONLY valid JSON, no markdown.',
      prompt,
      800,
      { jsonMode: true }
    );

    const parsed = parseJsonFromLLM(result);
    if (!parsed) throw new Error('No valid JSON found in LLM response');
    return parsed;
  } catch (err) {
    logger.warn({ err: err.message }, 'Postmortem generation failed');
    return null;
  }
}

/**
 * Generate and store a postmortem in the knowledge base.
 */
export async function generateAndStorePostmortem(task, responseText) {
  const pm = await generatePostmortem(task, responseText);
  if (!pm) return null;

  const content = [
    `Incident: ${pm.title}`,
    `Severity: ${pm.severity}`,
    `Project: ${task.project || 'unknown'}`,
    '',
    'Timeline:',
    pm.timeline,
    '',
    `Root Cause: ${pm.rootCause}`,
    '',
    `Fix Applied: ${pm.fix}`,
    '',
    `Impact: ${pm.impact}`,
    '',
    'Prevention:',
    pm.prevention,
  ].join('\n');

  try {
    const id = await ingest({
      type: 'postmortem',
      title: pm.title,
      content,
      summary: `[${pm.severity}] ${pm.rootCause}`,
      tags: ['postmortem', task.project || 'unknown', ...(pm.tags || [])],
      metadata: {
        taskId: task.id,
        severity: pm.severity,
        project: task.project,
        source: task.source,
        resolvedAt: new Date().toISOString(),
      },
    });
    logger.info({ id, title: pm.title, severity: pm.severity }, 'Postmortem stored');
    return { id, ...pm };
  } catch (err) {
    logger.warn({ err: err.message }, 'Failed to store postmortem');
    return pm;
  }
}

/**
 * Search postmortems in the knowledge base.
 */
export async function searchPostmortems(query, limit = 5) {
  try {
    return await kbSearch(query ? `postmortem ${query}` : 'postmortem', limit);
  } catch {
    return [];
  }
}

/**
 * Format postmortem search results for WhatsApp.
 */
export function formatPostmortemList(results) {
  if (!results || results.length === 0) {
    return '📋 No postmortems found.';
  }

  const lines = ['📋 *Incident Postmortems*\n'];
  for (const r of results) {
    const date = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const tags = r.tags?.filter(t => t !== 'postmortem').join(', ') || '';
    lines.push(`*${r.title || '(untitled)'}* (${date})`);
    lines.push(`  ${r.summary || r.excerpt || '(no summary)'}`);
    if (tags) lines.push(`  Tags: ${tags}`);
    lines.push('');
  }
  return lines.join('\n');
}
