/**
 * Memory Curator — extracts key facts from conversations and scores relevance.
 * Uses OpenRouter free models to keep cost at zero.
 */

import { storeManyMemories, storeMemory, saveSemantic } from './skills/memory-v2/lib/v1-compat.mjs';
import { callOpenRouter, callWithFallback, FREE_FALLBACK_CHAINS } from './router.js';

const EXTRACT_SYSTEM = `You are a memory extraction system for an AI assistant called Overlord.
Your job: extract durable, reusable facts from conversations that should be remembered for future interactions.

Extract TWO types of facts:

1. EPISODIC — Facts about the person, their preferences, decisions, people they mention (stored per-user)
2. SEMANTIC — System knowledge: tools, APIs, configs, infrastructure, capabilities discovered during the conversation (stored globally)

Extract ONLY facts that are:
- Stable and durable (not just this conversation — things that will matter next week)
- Actionable or meaningful for future responses

DO NOT extract:
- Current task status or one-off questions
- Things already obvious from the conversation itself
- Temporary states ("user seems frustrated")
- Anything that duplicates what's already in existing_memories

Output ONLY a valid JSON object with two arrays:
{
  "episodic": [
    {
      "content": "Full sentence stating the fact clearly",
      "summary": "Short label under 60 chars",
      "tags": ["preference"|"project"|"person"|"decision"|"rule"|"fact"|"error"|"boat"|"content"],
      "importance": 1-10
    }
  ],
  "semantic": [
    {
      "category": "tool"|"project"|"infrastructure"|"security"|"preference"|"person"|"pattern"|"integration",
      "topic": "specific subject (e.g., 'gws', 'namibarden')",
      "content": "Full description of the system knowledge",
      "importance": 0.1-1.0,
      "tags": ["relevant", "tags"]
    }
  ]
}

Episodic importance guide: 9-10: Standing orders, 7-8: Strong preferences, 5-6: Useful context, 3-4: Minor details
Semantic importance guide: 0.8-1.0: Critical tools/infra, 0.5-0.7: Useful knowledge, 0.3-0.4: Minor details

Return {"episodic":[],"semantic":[]} if nothing new. Do NOT wrap in markdown code fences.`;

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
    clean = clean.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');

    let parsed;
    // Try parsing as new format (object with episodic+semantic)
    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { parsed = JSON.parse(objMatch[0]); } catch { /* fall through */ }
    }

    // Fallback: try old format (plain array = all episodic)
    if (!parsed) {
      const arrayMatch = clean.match(/\[[\s\S]*\]/);
      if (!arrayMatch) return 0;
      try {
        const arr = JSON.parse(arrayMatch[0]);
        parsed = { episodic: arr, semantic: [] };
      } catch {
        console.error('[memory-curator] JSON parse failed:', clean.slice(0, 200));
        return 0;
      }
    }

    const episodicFacts = Array.isArray(parsed.episodic) ? parsed.episodic : [];
    const semanticFacts = Array.isArray(parsed.semantic) ? parsed.semantic : [];
    let stored = 0;

    // Store episodic memories (per-JID)
    const memories = episodicFacts
      .filter(f => f.content && f.content.length > 10)
      .slice(0, 5)
      .map(f => ({
        jid,
        content: String(f.content),
        summary: String(f.summary || f.content).slice(0, 60),
        tags: Array.isArray(f.tags) ? f.tags : ['fact'],
        importance: Math.min(10, Math.max(1, parseInt(f.importance) || 5)),
        source: 'auto',
      }));

    if (memories.length) {
      await storeManyMemories(memories);
      stored += memories.length;
    }

    // Store semantic memories (global system knowledge)
    const semanticToStore = semanticFacts
      .filter(f => f.content && f.category && f.topic && f.content.length > 10)
      .slice(0, 3);

    for (const sf of semanticToStore) {
      try {
        await saveSemantic({
          category: String(sf.category),
          topic: String(sf.topic),
          content: String(sf.content),
          importance: Math.min(1.0, Math.max(0.1, parseFloat(sf.importance) || 0.5)),
          tags: Array.isArray(sf.tags) ? sf.tags : [],
          source: 'observed',
        });
        stored++;
      } catch (err) {
        console.error('[memory-curator] Semantic store failed:', err.message);
      }
    }

    return stored;
  } catch (err) {
    console.error('[memory-curator] Extract error:', err.message);
    return 0;
  }
}

// scoreRelevance moved to skills/memory-v2/lib/v1-compat.mjs
