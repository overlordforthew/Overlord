/**
 * embeddings.mjs — Gemini embedding generation + Qdrant vector search
 *
 * Single gateway to all vector operations. No other module touches these APIs directly.
 * Every function fails gracefully — returns null/empty on error, never throws.
 */

import { QdrantClient } from '@qdrant/js-client-rest';

// ── CONFIG ──

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || '';
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIMS = 768;
const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}`;
const BATCH_EMBED_URL = `${EMBED_URL}:batchEmbedContents?key=${GOOGLE_API_KEY}`;
const SINGLE_EMBED_URL = `${EMBED_URL}:embedContent?key=${GOOGLE_API_KEY}`;

const QDRANT_URL = process.env.QDRANT_URL || 'http://qdrant:6333';
const QDRANT_FALLBACK_URL = 'http://127.0.0.1:6333';
const COLLECTION = 'observations';

// ── STATE ──

let qdrant = null;
let _available = null;       // cached availability
let _availableAt = 0;        // cache timestamp
const AVAIL_CACHE_MS = 30_000;

// ── QDRANT CLIENT ──

function getClient() {
  if (!qdrant) {
    // Try internal Docker network first, fallback to localhost
    qdrant = new QdrantClient({ url: QDRANT_URL, timeout: 5000 });
  }
  return qdrant;
}

/**
 * Check if Qdrant is reachable. Cached for 30s.
 */
export async function isAvailable() {
  const now = Date.now();
  if (_available !== null && now - _availableAt < AVAIL_CACHE_MS) return _available;
  try {
    const client = getClient();
    await client.getCollections();
    _available = true;
  } catch {
    // Try fallback URL (localhost for host-mode execution)
    try {
      qdrant = new QdrantClient({ url: QDRANT_FALLBACK_URL, timeout: 3000 });
      await qdrant.getCollections();
      _available = true;
    } catch {
      _available = false;
    }
  }
  _availableAt = now;
  return _available;
}

/**
 * Create the observations collection if it doesn't exist.
 */
export async function initCollection() {
  if (!await isAvailable()) return false;
  try {
    const client = getClient();
    const collections = await client.getCollections();
    const exists = collections.collections.some(c => c.name === COLLECTION);
    if (exists) return true;

    await client.createCollection(COLLECTION, {
      vectors: { size: EMBED_DIMS, distance: 'Cosine' },
      quantization_config: {
        scalar: { type: 'int8', quantile: 0.99, always_ram: true },
      },
      optimizers_config: { indexing_threshold: 100 },
    });
    console.log(`[embeddings] Created collection '${COLLECTION}' (${EMBED_DIMS}d, cosine, int8)`);
    return true;
  } catch (err) {
    console.error('[embeddings] initCollection failed:', err.message);
    return false;
  }
}

// ── GEMINI EMBEDDINGS ──

/**
 * Embed a single text. Returns float[768] or null on failure.
 */
export async function embed(text) {
  if (!text || !GOOGLE_API_KEY) return null;
  try {
    const res = await fetch(SINGLE_EMBED_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: text.slice(0, 8000) }] },
        outputDimensionality: EMBED_DIMS,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.embedding?.values || null;
  } catch {
    return null;
  }
}

/**
 * Embed multiple texts in one API call. Returns array of float[768][].
 * Missing embeddings are null in the result array.
 * Max 100 texts per batch (Gemini limit).
 */
export async function embedBatch(texts) {
  if (!texts?.length || !GOOGLE_API_KEY) return texts?.map(() => null) || [];

  const results = new Array(texts.length).fill(null);
  const BATCH_SIZE = 20;
  const BASE_DELAY_MS = 3000;
  const MAX_RETRIES = 3;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    if (i > 0) await new Promise(r => setTimeout(r, BASE_DELAY_MS));
    const batch = texts.slice(i, i + BATCH_SIZE);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const requests = batch.map(t => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text: (t || '').slice(0, 8000) }] },
          outputDimensionality: EMBED_DIMS,
        }));

        const res = await fetch(BATCH_EMBED_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
          signal: AbortSignal.timeout(60_000),
        });

        if (res.status === 429) {
          const wait = Math.min(60_000, BASE_DELAY_MS * Math.pow(2, attempt + 2));
          console.log(`[embeddings] batch ${i}: rate limited, waiting ${wait / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await new Promise(r => setTimeout(r, wait));
          continue;
        }
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error(`[embeddings] batch ${i}-${i + batch.length} failed: ${res.status} ${errText.slice(0, 200)}`);
          break;
        }
        const data = await res.json();
        const embeddings = data?.embeddings || [];
        for (let j = 0; j < embeddings.length; j++) {
          results[i + j] = embeddings[j]?.values || null;
        }
        console.log(`[embeddings] batch ${i}-${i + batch.length}: ${embeddings.length} embedded`);
        break; // success
      } catch (err) {
        console.error(`[embeddings] batch ${i}-${i + batch.length} error:`, err.message);
        break;
      }
    }
  }
  return results;
}

// ── QDRANT OPERATIONS ──

/**
 * Upsert a single point into Qdrant.
 * @param {number} id - Observation ID (used as point ID)
 * @param {number[]} vector - Embedding vector
 * @param {object} payload - Metadata (type, category, importance, jid, title)
 */
export async function upsert(id, vector, payload = {}) {
  if (!vector || !await isAvailable()) return false;
  try {
    const client = getClient();
    await client.upsert(COLLECTION, {
      wait: true,
      points: [{ id, vector, payload }],
    });
    return true;
  } catch (err) {
    console.error('[embeddings] upsert failed:', err.message);
    return false;
  }
}

/**
 * Upsert multiple points in one call.
 */
export async function upsertBatch(points) {
  if (!points?.length || !await isAvailable()) return false;
  try {
    const client = getClient();
    const BATCH = 100;
    for (let i = 0; i < points.length; i += BATCH) {
      await client.upsert(COLLECTION, {
        wait: true,
        points: points.slice(i, i + BATCH),
      });
    }
    return true;
  } catch (err) {
    console.error('[embeddings] upsertBatch failed:', err.message);
    return false;
  }
}

/**
 * Search for similar vectors in Qdrant.
 * @param {number[]} vector - Query vector
 * @param {number} limit - Max results
 * @param {object} filter - Qdrant filter (optional)
 * @returns {Array<{id, score, payload}>} Results sorted by similarity
 */
export async function search(vector, limit = 10, filter = null) {
  if (!vector || !await isAvailable()) return [];
  try {
    const client = getClient();
    const params = { vector, limit, with_payload: true };
    if (filter) params.filter = filter;
    const results = await client.search(COLLECTION, params);
    return results.map(r => ({ id: r.id, score: r.score, payload: r.payload }));
  } catch {
    return [];
  }
}

/**
 * Check if a similar vector already exists (for dedup).
 * Returns the existing observation ID if cosine similarity > threshold, else null.
 *
 * @param {number[]} vector - Candidate vector
 * @param {number} threshold - Similarity threshold (default 0.85)
 * @param {object} filter - Additional Qdrant filter (e.g., same JID for episodic)
 * @returns {number|null} Existing observation ID or null
 */
export async function dedupCheck(vector, threshold = 0.85, filter = null) {
  if (!vector || !await isAvailable()) return null;
  try {
    const results = await search(vector, 1, filter);
    if (results.length > 0 && results[0].score >= threshold) {
      return results[0].id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Delete a point from Qdrant by observation ID.
 */
export async function remove(id) {
  if (!await isAvailable()) return false;
  try {
    const client = getClient();
    await client.delete(COLLECTION, { wait: true, points: [id] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get collection info (point count, etc).
 */
export async function collectionInfo() {
  if (!await isAvailable()) return null;
  try {
    const client = getClient();
    return await client.getCollection(COLLECTION);
  } catch {
    return null;
  }
}

// ── HELPERS ──

/**
 * Build embedding text from an observation record.
 * Combines title + narrative for richer semantic signal.
 */
export function observationToText(obs) {
  const parts = [];
  if (obs.category) parts.push(`[${obs.category}]`);
  if (obs.title) parts.push(obs.title);
  if (obs.narrative) parts.push(obs.narrative);
  if (obs.facts) parts.push(obs.facts);
  return parts.join(' ').slice(0, 8000);
}

/**
 * Build Qdrant payload from an observation record.
 */
export function observationToPayload(obs) {
  return {
    type: obs.type || 'unknown',
    category: obs.category || '',
    title: obs.title || '',
    importance: obs.importance || 0.5,
    jid: obs.jid || '',
    status: obs.status || 'active',
  };
}

export { EMBED_DIMS, COLLECTION };
