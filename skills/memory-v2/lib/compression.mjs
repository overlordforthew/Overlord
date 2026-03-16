import { getUncompressedEvents } from './events.mjs';

/**
 * Format pending tool events into a compression prompt for Claude.
 * Returns { prompt, lastEventId, eventCount } or null if nothing to compress.
 */
export function formatCompressionPrompt({ threshold = 10 } = {}) {
  const events = getUncompressedEvents(200);
  if (events.length < threshold) return null;

  const lastEventId = events[events.length - 1].id;

  // Group events by logical clusters
  const lines = events.map(e => {
    const ts = new Date(e.timestamp).toISOString().slice(11, 19);
    const proj = e.project ? `[${e.project}]` : '';
    return `  ${ts} ${proj} ${e.tool_name}: ${e.input_summary || '(no summary)'}`;
  });

  const prompt = `MEMORY SYSTEM: ${events.length} tool events pending compression. Review these events and extract 1-5 observations.

Raw events:
${lines.join('\n')}

For each observation, run:
  node /root/overlord/skills/memory-v2/scripts/memory.mjs store --type <decision|bugfix|feature|refactor|discovery|config> --title "..." --narrative "..." --facts '["fact1","fact2"]' --concepts '["concept1"]'

Optionally add: --files-read '["path"]' --files-modified '["path"]' --outcome worked|failed|partial --project <ProjectName>

After storing all observations, run:
  node /root/overlord/skills/memory-v2/scripts/memory.mjs mark-compressed --through-id ${lastEventId}`;

  return { prompt, lastEventId, eventCount: events.length };
}
