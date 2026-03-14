/**
 * Memory Curator — extracts key facts from conversations and scores relevance.
 * Uses OpenRouter free models to keep cost at zero.
 */

import { storeManyMemories, storeMemory } from './memory-store.js';
import { callOpenRouter, callWithFallback, FREE_FALLBACK_CHAINS } from './router.js';

const EXTRACT_SYSTEM = `You are a memory extraction system for an AI assistant called Overlord.
Your job: extract durable, reusable facts from conversations that should be remembered for future interactions.

Extract ONLY facts that are:
1. Stable and durable (not just this conversation — things that will matter next week)
2. Actionable or meaningful for future responses
3. About the person, their projects, preferences, decisions, or people they mention

DO NOT extract:
- Current task status or one-off questions
- Things already obvious from the conversation itself
- Temporary states ("user seems frustrated")
- Anything that duplicates what's already in existing_memories

Output ONLY a valid JSON array. Each item:
{
  "content": "Full sentence stating the fact clearly",
  "summary": "Short label under 60 chars",
  "tags": ["preference"|"project"|"person"|"decision"|"rule"|"fact"|"error"|"boat"|"content"],
  "importance": 1-10
}

Importance guide:
- 9-10: Permanent standing orders ("ALWAYS do X", "NEVER do Y"), hard rules
- 7-8: Strong preferences, project rules, key contacts
- 5-6: Useful context about projects, people, or plans
- 3-4: Minor details worth noting
- 1-2: Trivia, probably won't matter

Return [] if nothing new is worth storing. Do NOT wrap in markdown code fences.`;

/**
 * Extract memorable facts from a conversation exchange.
 * Runs async after response — does NOT block the reply.
 */
export async function extractAndStore(jid, { userMessage, assistantResponse, existingMemories = '' }) {
  try {
    if (!userMessage || userMessage.length < 15) return 0; // Skip tiny messages

    const prompt = `<existing_memories>
${existingMemories.slice(0, 800)}
</existing_memories>

<conversation>
User: ${userMessage.slice(0, 1500)}
Assistant: ${assistantResponse.slice(0, 1500)}
</conversation>

Extract new facts worth remembering. Return [] if nothing new.`;

    // Use free models — this is background work, doesn't need premium
    let result;
    try {
      const { response } = await callWithFallback(
        FREE_FALLBACK_CHAINS.triage || ['step-flash', 'gemini-flash'],
        EXTRACT_SYSTEM,
        prompt,
        800
      );
      result = response;
    } catch (err) {
      console.error('[memory-curator] All free models failed:', err.message);
      return 0;
    }

    if (!result || typeof result !== 'string') return 0;

    // Parse JSON — handle possible markdown fences or preamble
    let clean = result.trim();
    // Strip markdown code fences
    clean = clean.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');
    // Try to find the JSON array
    const arrayMatch = clean.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return 0;

    let facts;
    try {
      facts = JSON.parse(arrayMatch[0]);
    } catch {
      console.error('[memory-curator] JSON parse failed:', clean.slice(0, 200));
      return 0;
    }

    if (!Array.isArray(facts) || facts.length === 0) return 0;

    const memories = facts
      .filter(f => f.content && f.summary && f.content.length > 10)
      .slice(0, 5) // Cap at 5 per exchange to avoid runaway extraction
      .map(f => ({
        jid,
        content: String(f.content),
        summary: String(f.summary).slice(0, 60),
        tags: Array.isArray(f.tags) ? f.tags : ['fact'],
        importance: Math.min(10, Math.max(1, parseInt(f.importance) || 5)),
        source: 'auto',
      }));

    if (memories.length) {
      await storeManyMemories(memories);
    }

    return memories.length;
  } catch (err) {
    console.error('[memory-curator] Extract error:', err.message);
    return 0;
  }
}

/**
 * Score retrieved memories for relevance to current message.
 * Pure heuristic — no API call, runs in <1ms.
 */
export function scoreRelevance(memories, currentMessage, limit = 15) {
  if (memories.length <= limit) return memories;

  const words = new Set(
    currentMessage.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  );

  const scored = memories.map(m => {
    let score = m.importance || 5;
    // Keyword overlap boost
    const mWords = m.content.toLowerCase().split(/\W+/);
    const overlap = mWords.filter(w => words.has(w)).length;
    score += overlap * 2;
    // Recency boost (last 7 days)
    const age = Date.now() - new Date(m.created_at).getTime();
    if (age < 7 * 24 * 3600 * 1000) score += 1;
    // Access frequency boost
    if (m.access_count > 5) score += 1;
    return { ...m, _score: score };
  });

  return scored
    .sort((a, b) => b._score - a._score)
    .slice(0, limit);
}
