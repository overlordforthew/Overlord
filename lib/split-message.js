/**
 * Shared message splitting for WhatsApp's ~4096 char limit.
 * Used by executor.js, scheduler.js, and index.js.
 */

export function splitMessage(text, maxLen = 3900) {
  if (!text || !text.trim()) return [];
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = maxLen;
    const para = remaining.lastIndexOf('\n\n', maxLen);
    if (para > maxLen * 0.5) { splitAt = para; }
    else {
      const sent = remaining.lastIndexOf('. ', maxLen);
      if (sent > maxLen * 0.5) { splitAt = sent + 1; }
      else {
        const line = remaining.lastIndexOf('\n', maxLen);
        if (line > maxLen * 0.5) { splitAt = line; }
      }
    }
    chunks.push(remaining.substring(0, splitAt).trimEnd());
    remaining = remaining.substring(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
