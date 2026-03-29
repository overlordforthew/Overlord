/**
 * Memory Curator — extracts key facts from conversations and scores relevance.
 * Uses OpenRouter free models to keep cost at zero.
 */

import { storeManyMemories, storeMemory, saveSemantic } from './skills/memory-v2/lib/v1-compat.mjs';
import { callOpenRouter, callWithFallback, FREE_FALLBACK_CHAINS } from './router.js';

const EXTRACT_SYSTEM = `You are the memory extraction engine for Overlord, an AI assistant that manages Gil's server and projects.
Your job: extract durable, actionable knowledge from conversations that will improve future interactions.

Extract TWO types of memories:

1. EPISODIC — Per-person knowledge that shapes how Overlord interacts with them:
   - **Decisions made** — "Gil decided to use Stripe for NamiBarden payments" (not "Gil is thinking about payments")
   - **Preferences revealed** — "Gil wants terse responses, no trailing summaries"
   - **Relationships & people** — "Emiel is Gil's Dutch friend, potential CTO for MasterCommander"
   - **Standing orders** — "Always run codex review after significant commits"
   - **Project context** — "NamiBarden targets Japanese-first audience, English secondary"
   - **Corrections** — "Gil said don't mock the database in integration tests"

2. SEMANTIC — Global system knowledge (tools, APIs, configs, patterns):
   - **New capabilities discovered** — tool installed, API enabled, config changed
   - **Patterns that worked** — approaches that solved problems (reusable across projects)
   - **Infrastructure changes** — DNS, containers, services added/removed/modified

QUALITY RULES:
- Extract the WHY, not just the WHAT. "Gil chose Stripe because the audience is 99% Japanese LINE users" > "Gil chose Stripe"
- Be specific and actionable. "Nami's hero copy approved: 「結果を出してきた。でも、なぜか満たされない。」" > "Hero copy was discussed"
- Include names, URLs, versions, flags — concrete details that a future AI needs
- If a fact UPDATES something in existing_memories, extract it with the same summary so it overwrites
- If a fact is already in existing_memories and unchanged, DO NOT extract it

DO NOT extract:
- Greetings, small talk, or one-off questions
- Temporary states ("working on X right now")
- Vague observations ("user seems interested in AI")
- Anything already captured in existing_memories (check carefully!)

Output ONLY a valid JSON object:
{
  "episodic": [
    {
      "content": "Full sentence with specific details and context",
      "summary": "Short label under 60 chars (used as dedup key)",
      "tags": ["preference"|"project"|"person"|"decision"|"rule"|"fact"|"error"|"boat"|"content"|"correction"],
      "importance": 1-10
    }
  ],
  "semantic": [
    {
      "category": "tool"|"project"|"infrastructure"|"security"|"preference"|"person"|"pattern"|"integration",
      "topic": "specific subject (e.g., 'gws CLI', 'namibarden SEO')",
      "content": "Full description with concrete details",
      "importance": 0.1-1.0,
      "tags": ["relevant", "tags"]
    }
  ]
}

Importance guide (episodic): 9-10: Standing orders/rules, 7-8: Decisions/strong preferences, 5-6: Useful context, 3-4: Minor details
Importance guide (semantic): 0.8-1.0: Critical tools/infra, 0.5-0.7: Useful patterns, 0.3-0.4: Minor discoveries

Return {"episodic":[],"semantic":[]} if nothing new. Do NOT wrap in markdown code fences.`;

/**
 * Extract memorable facts from a conversation exchange.
 * Runs async after response — does NOT block the reply.
 */
export async function extractAndStore(jid, { userMessage, assistantResponse, existingMemories = '' }) {
  try {
    if (!userMessage || userMessage.length < 15) return 0; // Skip tiny messages

    // Build a concise existing memory digest for dedup
    const memDigest = existingMemories
      .split('\n')
      .filter(l => l.trim().startsWith('-'))
      .map(l => l.trim())
      .slice(0, 40)
      .join('\n');

    const prompt = `<existing_memories>
${memDigest.slice(0, 2500) || '(none yet)'}
</existing_memories>

<conversation>
User: ${userMessage.slice(0, 3000)}
Assistant: ${assistantResponse.slice(0, 3000)}
</conversation>

Extract new or updated facts. If a fact updates an existing memory, use the SAME summary so it overwrites. Return {"episodic":[],"semantic":[]} if nothing new.`;

    // Use free models — this is background work, doesn't need premium
    let result;
    try {
      const { response } = await callWithFallback(
        FREE_FALLBACK_CHAINS.triage || ['step-flash', 'gemini-flash'],
        EXTRACT_SYSTEM,
        prompt,
        1200,
        { jsonMode: true }
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

    // Fire-and-forget: also store in mem0ai for vector search
    if (stored > 0) {
      storeMem0(jid, userMessage, assistantResponse).catch(() => {});
    }

    return stored;
  } catch (err) {
    console.error('[memory-curator] Extract error:', err.message);
    return 0;
  }
}

// mem0ai secondary memory layer — vector-based semantic search
let _mem0 = null;
async function getMem0() {
  if (_mem0) return _mem0;
  try {
    const { MemoryClient } = await import('mem0ai');
    // Use mem0 cloud if API key available, otherwise skip
    if (!process.env.MEM0_API_KEY) return null;
    _mem0 = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
    return _mem0;
  } catch {
    return null;
  }
}

async function storeMem0(jid, userMessage, assistantResponse) {
  try {
    const mem0 = await getMem0();
    if (!mem0) return;
    const userId = jid.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
    await mem0.add([
      { role: 'user', content: (userMessage || '').slice(0, 2000) },
      { role: 'assistant', content: (assistantResponse || '').slice(0, 2000) },
    ], { user_id: userId });
  } catch (err) {
    console.error('[mem0] Background store failed:', err.message);
  }
}

export { getMem0 };

// scoreRelevance moved to skills/memory-v2/lib/v1-compat.mjs
