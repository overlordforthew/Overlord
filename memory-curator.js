/**
 * Memory Curator v3 — Opus-powered extraction with vector dedup and crash safety.
 *
 * Changes from v2:
 * - Uses Claude Opus 4.6 via OpenRouter (not free models)
 * - Real-time vector dedup via Qdrant before storing
 * - Crash-resilient: pending extractions tracked, flushed on SIGTERM
 * - Standing orders and corrections auto-detected with high importance
 */

import { storeManyMemories, storeMemory, saveSemantic } from './skills/memory-v2/lib/v1-compat.mjs';
import { embed, dedupCheck, upsert, isAvailable, observationToPayload } from './skills/memory-v2/lib/embeddings.mjs';
import { getDb } from './skills/memory-v2/lib/db.mjs';
import { initSchema } from './skills/memory-v2/lib/schema.mjs';

const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const EXTRACT_MODEL = 'anthropic/claude-opus-4';

// Track in-flight extractions for crash safety
const pendingExtractions = new Set();

// Derive category from episodic tags for proper classification
const TAG_TO_CATEGORY = {
  'standing-order': 'preference', correction: 'preference', preference: 'preference',
  rule: 'rule', decision: 'rule',
  project: 'project', person: 'person',
  error: 'infrastructure', infrastructure: 'infrastructure',
  tool: 'tool', pattern: 'pattern', security: 'security',
};
function deriveCategoryFromTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return 'general';
  for (const t of tags) { if (TAG_TO_CATEGORY[t]) return TAG_TO_CATEGORY[t]; }
  return 'general';
}

const EXTRACT_SYSTEM = `You are the memory extraction engine for Overlord, an AI assistant that manages Gil's server and projects.
Your job: extract durable, actionable knowledge from conversations that will improve future interactions.

Extract TWO types of memories:

1. EPISODIC — Per-person knowledge that shapes how Overlord interacts with them:
   - **Standing orders** — "Always X", "Never Y", "From now on Z" → tag: "standing-order", importance 9-10
   - **Corrections** — User corrects bot behavior, says "no", "don't", "stop doing X" → tag: "correction", importance 9
   - **Decisions made** — "Gil decided to use Stripe for NamiBarden payments" (not "Gil is thinking about")
   - **Preferences revealed** — "Gil wants terse responses, no trailing summaries"
   - **Relationships & people** — "Emiel is Gil's Dutch friend, potential CTO for MasterCommander"
   - **Project context** — "NamiBarden targets Japanese-first audience, English secondary"

2. SEMANTIC — Global system knowledge (tools, APIs, configs, patterns):
   - **New capabilities discovered** — tool installed, API enabled, config changed
   - **Patterns that worked** — approaches that solved problems (reusable across projects)
   - **Infrastructure changes** — DNS, containers, services added/removed/modified

QUALITY RULES:
- Extract the WHY, not just the WHAT. "Gil chose Stripe because the audience is 99% Japanese LINE users" > "Gil chose Stripe"
- Be specific and actionable. Include names, URLs, versions, flags — concrete details
- If a fact UPDATES something in existing_memories, extract it with the same summary so it overwrites
- If a fact is already in existing_memories and unchanged, DO NOT extract it
- Standing orders and corrections are the HIGHEST priority — never miss them

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
      "tags": ["standing-order"|"correction"|"preference"|"project"|"person"|"decision"|"rule"|"fact"|"error"|"boat"|"content"],
      "importance": 1-10
    }
  ],
  "semantic": [
    {
      "category": "tool"|"project"|"infrastructure"|"security"|"preference"|"person"|"pattern"|"integration"|"rule",
      "topic": "specific subject (e.g., 'gws CLI', 'namibarden SEO')",
      "content": "Full description with concrete details",
      "importance": 0.1-1.0,
      "tags": ["relevant", "tags"]
    }
  ]
}

Importance guide (episodic — be strict):
  9-10: Standing orders, corrections, explicit rules. These PERSIST forever.
  7-8: Firm decisions or strong preferences explicitly stated. Max 1-2 per extraction.
  5-6: Useful context, project details, people info. This is the DEFAULT bucket.
  3-4: Minor details, one-off mentions.
Importance guide (semantic): 0.8-1.0: Critical tools/infra, 0.5-0.7: Useful patterns, 0.3-0.4: Minor discoveries

Return {"episodic":[],"semantic":[]} if nothing new. Do NOT wrap in markdown code fences.`;

/**
 * Call Opus via OpenRouter for extraction.
 */
async function callOpus(systemPrompt, userPrompt, maxTokens = 1500) {
  if (!OPENROUTER_KEY) throw new Error('OPENROUTER_KEY not set');

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer': 'https://namibarden.com',
      'X-Title': 'Overlord Memory Curator',
    },
    body: JSON.stringify({
      model: EXTRACT_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.1,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}

/**
 * Extract memorable facts from a conversation exchange.
 * Uses Opus for extraction quality. Includes vector dedup before storing.
 */
export async function extractAndStore(jid, { userMessage, assistantResponse, existingMemories = '' }) {
  const extractionId = `${jid}-${Date.now()}`;
  pendingExtractions.add(extractionId);

  try {
    if (!userMessage || userMessage.length < 15) return 0;

    // Build existing memory digest for dedup
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
User: ${userMessage.slice(0, 4000)}
Assistant: ${assistantResponse.slice(0, 4000)}
</conversation>

Extract new or updated facts. Return {"episodic":[],"semantic":[]} if nothing new.`;

    // Use Opus via OpenRouter for maximum extraction quality
    let result;
    try {
      result = await callOpus(EXTRACT_SYSTEM, prompt);
    } catch (err) {
      console.error('[memory-curator] Opus extraction failed:', err.message);
      return 0;
    }

    if (!result || typeof result !== 'string') return 0;

    // Parse JSON
    let clean = result.trim();
    clean = clean.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '');

    let parsed;
    const objMatch = clean.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try { parsed = JSON.parse(objMatch[0]); } catch { /* fall through */ }
    }

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

    // ── EPISODIC with vector dedup ──
    for (const f of episodicFacts.filter(f => f.content?.length > 10).slice(0, 5)) {
      const importance = Math.min(10, Math.max(1, parseInt(f.importance) || 5));
      const tags = Array.isArray(f.tags) ? f.tags : ['fact'];

      // Auto-elevate standing orders and corrections
      const isStandingOrder = tags.includes('standing-order') || tags.includes('correction');
      const finalImportance = isStandingOrder ? Math.max(importance, 9) : importance;

      // Vector dedup: check if similar memory already exists for this JID
      const text = String(f.content);
      const vector = await embed(text);
      if (vector) {
        const filter = { must: [{ key: 'jid', match: { value: jid } }, { key: 'type', match: { value: 'episodic' } }] };
        const existingId = await dedupCheck(vector, 0.85, filter);
        if (existingId) {
          // Update existing instead of creating new
          try {
            initSchema();
            const db = getDb();
            db.prepare(`
              UPDATE observations SET narrative = ?, importance = MAX(importance, ?), updated_at = ?, tags = ?
              WHERE id = ? AND status = 'active'
            `).run(text, finalImportance / 10, Date.now(), JSON.stringify(tags), existingId);
            // Update Qdrant payload
            const category = deriveCategoryFromTags(tags);
            await upsert(existingId, vector, { type: 'episodic', category, title: String(f.summary || text).slice(0, 60), importance: finalImportance / 10, jid, status: 'active' });
            stored++;
          } catch (err) {
            console.error('[memory-curator] Dedup update failed:', err.message);
          }
          continue;
        }
      }

      // Derive category from tags
      const category = deriveCategoryFromTags(tags);

      // No duplicate — store new
      const id = await storeMemory({
        jid,
        content: text,
        summary: String(f.summary || text).slice(0, 60),
        tags,
        importance: finalImportance,
        source: 'auto',
        category,
      });

      // Embed and upsert to Qdrant
      if (id && vector) {
        await upsert(id, vector, { type: 'episodic', category, title: String(f.summary || text).slice(0, 60), importance: finalImportance / 10, jid, status: 'active' });
      }
      stored++;
    }

    // ── SEMANTIC with vector dedup ──
    for (const sf of semanticFacts.filter(f => f.content && f.category && f.topic && f.content.length > 10).slice(0, 3)) {
      const importance = Math.min(1.0, Math.max(0.1, parseFloat(sf.importance) || 0.5));
      const text = `[${sf.category}] ${sf.topic}: ${sf.content}`;

      // Vector dedup for semantic
      const vector = await embed(text);
      if (vector) {
        const filter = { must: [{ key: 'type', match: { value: 'semantic' } }] };
        const existingId = await dedupCheck(vector, 0.85, filter);
        if (existingId) {
          // Update existing semantic memory
          try {
            initSchema();
            const db = getDb();
            db.prepare(`
              UPDATE observations SET narrative = ?, importance = MAX(importance, ?), updated_at = ?, tags = ?
              WHERE id = ? AND status = 'active'
            `).run(String(sf.content), importance, Date.now(), JSON.stringify(sf.tags || []), existingId);
            await upsert(existingId, vector, { type: 'semantic', category: String(sf.category), title: String(sf.topic), importance, jid: '', status: 'active' });
            stored++;
          } catch (err) {
            console.error('[memory-curator] Semantic dedup update failed:', err.message);
          }
          continue;
        }
      }

      // No duplicate — store new
      try {
        const id = await saveSemantic({
          category: String(sf.category),
          topic: String(sf.topic),
          content: String(sf.content),
          importance,
          tags: Array.isArray(sf.tags) ? sf.tags : [],
          source: 'observed',
        });
        if (id && vector) {
          await upsert(id, vector, { type: 'semantic', category: String(sf.category), title: String(sf.topic), importance, jid: '', status: 'active' });
        }
        stored++;
      } catch (err) {
        console.error('[memory-curator] Semantic store failed:', err.message);
      }
    }

    if (stored > 0) {
      console.log(`[memory-curator] Extracted ${stored} facts from ${jid} (Opus)`);
    }

    return stored;
  } catch (err) {
    console.error('[memory-curator] Extract error:', err.message);
    return 0;
  } finally {
    pendingExtractions.delete(extractionId);
  }
}

/**
 * Flush all pending extractions. Called on SIGTERM for crash safety.
 * Returns when all in-flight extractions complete (max 10s).
 */
export async function flushPendingExtractions() {
  if (pendingExtractions.size === 0) return;
  console.log(`[memory-curator] Flushing ${pendingExtractions.size} pending extractions...`);
  // Give extractions up to 10 seconds to complete
  const deadline = Date.now() + 10_000;
  while (pendingExtractions.size > 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
  }
  if (pendingExtractions.size > 0) {
    console.warn(`[memory-curator] ${pendingExtractions.size} extractions still pending at shutdown`);
  }
}

// Legacy mem0ai support — kept for backward compatibility
let _mem0 = null;
async function getMem0() {
  if (_mem0) return _mem0;
  try {
    const { MemoryClient } = await import('mem0ai');
    if (!process.env.MEM0_API_KEY) return null;
    _mem0 = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
    return _mem0;
  } catch {
    return null;
  }
}

export { getMem0, flushPendingExtractions as flush };
