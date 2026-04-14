/**
 * Robust JSON extraction from LLM responses.
 * Handles markdown fences, trailing text, and truncated output.
 */

export function parseJsonFromLLM(raw) {
  if (!raw || typeof raw !== 'string') return null;

  let text = raw.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  // Strip common LLM preamble like "Here is the JSON:" or "Sure! "
  text = text.replace(/^(?:(?:here|sure|okay|certainly)[^{]*)/i, '').trim();

  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch { /* fall through */ }

  // Some models wrap in single quotes or use JS-style — try fixing common issues
  // Replace single-quoted keys/values with double quotes (basic heuristic)
  if (text.includes("'") && !text.includes('"')) {
    try {
      return JSON.parse(text.replace(/'/g, '"'));
    } catch { /* fall through */ }
  }

  // Handle trailing commas before } or ]
  try {
    const noTrailing = text.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(noTrailing);
  } catch { /* fall through */ }

  // Extract first JSON object by finding { and matching }
  const start = text.indexOf('{');
  if (start === -1) return null;

  // Find the last } in the string
  const end = text.lastIndexOf('}');
  if (end > start) {
    try {
      return JSON.parse(text.substring(start, end + 1));
    } catch { /* fall through */ }
  }

  // Truncated JSON — try to close it
  const partial = text.substring(start);
  const repaired = repairTruncatedJson(partial);
  if (repaired) {
    try {
      return JSON.parse(repaired);
    } catch { /* give up */ }
  }

  return null;
}

function repairTruncatedJson(str) {
  // Count unclosed braces and brackets
  let braces = 0;
  let brackets = 0;
  let inString = false;
  let escaped = false;

  for (const ch of str) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }

  if (braces <= 0 && brackets <= 0) return null;

  // Trim trailing incomplete values (unfinished string, trailing comma)
  let repaired = str;
  if (inString) {
    // Remove the last incomplete string value
    const lastQuote = repaired.lastIndexOf('"');
    repaired = repaired.substring(0, lastQuote) + '""';
  }
  repaired = repaired.replace(/,\s*$/, '');

  // Close brackets then braces
  repaired += ']'.repeat(Math.max(0, brackets));
  repaired += '}'.repeat(Math.max(0, braces));

  return repaired;
}
