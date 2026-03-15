/**
 * Overlord Episodic Memory Store
 * Replaces flat memory.md files with indexed, searchable episodic memories.
 * Inspired by Memex(RL): arxiv:2603.04257
 */

import pg from 'pg';
import fs from 'fs/promises';
import { readFileSync } from 'fs';
import path from 'path';
import { ensureSemanticSchema } from './semantic-store.js';

// Read DB password: env var first, fallback to mounted secret file
let _dbPass = process.env.CONV_DB_PASS || process.env.MEMORY_DB_PASS;
if (!_dbPass) {
  try { _dbPass = readFileSync('/app/data/.overlord-db-pass', 'utf-8').trim(); } catch { /* ignore */ }
}

const pool = new pg.Pool({
  host: process.env.MEMORY_DB_HOST || 'overlord-db',
  port: parseInt(process.env.MEMORY_DB_PORT || '5432'),
  database: process.env.MEMORY_DB_NAME || 'overlord',
  user: process.env.MEMORY_DB_USER || 'overlord',
  password: _dbPass,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[memory-store] Pool error:', err.message);
});

// ── INIT ─────────────────────────────────────────────────────────────────────

export async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS episodic_memories (
        id SERIAL PRIMARY KEY,
        jid TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT NOT NULL,
        tags TEXT[] DEFAULT '{}',
        importance INTEGER DEFAULT 5,
        source TEXT DEFAULT 'auto',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_accessed TIMESTAMPTZ DEFAULT NOW(),
        access_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_jid ON episodic_memories(jid)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_memories_tags ON episodic_memories USING gin(tags)`);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_memories_content_fts
      ON episodic_memories USING gin(to_tsvector('english', content))
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_memories_importance
      ON episodic_memories(jid, importance DESC, last_accessed DESC)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS memory_seeds (
        jid TEXT PRIMARY KEY,
        seeded_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } finally {
    client.release();
  }

  // Create semantic + procedural + association tables
  await ensureSemanticSchema();
}

// ── STORE ─────────────────────────────────────────────────────────────────────

export async function storeMemory({ jid, content, summary, tags = [], importance = 5, source = 'auto' }) {
  // Dedup: skip if very similar content already exists for this jid
  const { rows: existing } = await pool.query(
    `SELECT id FROM episodic_memories
     WHERE jid = $1 AND is_active = TRUE
       AND similarity(content, $2) > 0.7
     LIMIT 1`,
    [jid, content.trim()]
  );
  if (existing.length) return existing[0].id;

  const { rows } = await pool.query(
    `INSERT INTO episodic_memories (jid, content, summary, tags, importance, source)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [jid, content.trim(), summary.trim(), tags, importance, source]
  );
  return rows[0].id;
}

export async function storeManyMemories(memories) {
  if (!memories.length) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const m of memories) {
      await client.query(
        `INSERT INTO episodic_memories (jid, content, summary, tags, importance, source)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [m.jid, m.content.trim(), m.summary.trim(), m.tags || [], m.importance || 5, m.source || 'auto']
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── RETRIEVE ──────────────────────────────────────────────────────────────────

/**
 * Retrieve memories for a user, blending:
 * 1. High-importance standing orders (always included)
 * 2. Full-text search matches for the current query
 * 3. Recent memories as fallback
 */
export async function retrieveMemories(jid, { query = '', limit = 20 } = {}) {
  const client = await pool.connect();
  try {
    // Always get critical memories (importance >= 8)
    const { rows: critical } = await client.query(
      `SELECT id, content, summary, tags, importance, created_at
       FROM episodic_memories
       WHERE jid = $1 AND is_active = TRUE AND importance >= 8
       ORDER BY importance DESC, last_accessed DESC
       LIMIT 10`,
      [jid]
    );

    // FTS search if query provided
    let ftsRows = [];
    if (query && query.length > 3) {
      const { rows } = await client.query(
        `SELECT id, content, summary, tags, importance, created_at,
                ts_rank(to_tsvector('english', content), plainto_tsquery('english', $2)) AS rank
         FROM episodic_memories
         WHERE jid = $1 AND is_active = TRUE
           AND to_tsvector('english', content) @@ plainto_tsquery('english', $2)
         ORDER BY rank DESC, importance DESC
         LIMIT $3`,
        [jid, query, limit]
      );
      ftsRows = rows;
    }

    // Recent memories as context
    const { rows: recent } = await client.query(
      `SELECT id, content, summary, tags, importance, created_at
       FROM episodic_memories
       WHERE jid = $1 AND is_active = TRUE
       ORDER BY last_accessed DESC, importance DESC
       LIMIT $2`,
      [jid, limit]
    );

    // Merge and deduplicate by id, priority: critical > fts > recent
    const seen = new Set();
    const merged = [];
    for (const row of [...critical, ...ftsRows, ...recent]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        merged.push(row);
      }
    }

    // Update access stats for retrieved memories
    const ids = merged.map(r => r.id);
    if (ids.length) {
      await client.query(
        `UPDATE episodic_memories
         SET last_accessed = NOW(), access_count = access_count + 1
         WHERE id = ANY($1)`,
        [ids]
      );
    }

    return merged;
  } finally {
    client.release();
  }
}

// ── FORMAT ────────────────────────────────────────────────────────────────────

/**
 * Format retrieved memories into a compact block for prompt injection.
 */
export function formatMemoriesForPrompt(memories) {
  if (!memories.length) return '(No memories stored yet)';

  const critical = memories.filter(m => m.importance >= 8);
  const other = memories.filter(m => m.importance < 8);

  const lines = [];

  if (critical.length) {
    lines.push('## Standing Orders & Critical Facts');
    for (const m of critical) {
      lines.push(`- ${m.content}`);
    }
  }

  if (other.length) {
    lines.push('## Context');
    for (const m of other.slice(0, 15)) {
      lines.push(`- ${m.content}`);
    }
  }

  return lines.join('\n');
}

// ── SEED ──────────────────────────────────────────────────────────────────────

/**
 * One-time import: parse existing memory.md into episodic memories.
 */
export async function seedFromLegacyFile(jid, legacyMarkdown) {
  const { rows } = await pool.query(
    'SELECT 1 FROM memory_seeds WHERE jid = $1', [jid]
  );
  if (rows.length) return false; // Already seeded

  const lines = legacyMarkdown
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('_') && l.length > 10);

  const memories = lines.map(line => ({
    jid,
    content: line.replace(/^[-*•]\s*/, ''),
    summary: line.replace(/^[-*•]\s*/, '').slice(0, 60),
    tags: inferTags(line),
    importance: inferImportance(line),
    source: 'seed',
  }));

  if (memories.length) {
    await storeManyMemories(memories);
  }

  await pool.query(
    'INSERT INTO memory_seeds (jid) VALUES ($1) ON CONFLICT DO NOTHING', [jid]
  );

  return memories.length;
}

function inferTags(text) {
  const t = text.toLowerCase();
  const tags = [];
  if (/prefer|always|never|want|like|hate|permanent/i.test(t)) tags.push('preference');
  if (/project|deploy|docker|container|domain|server|repo/i.test(t)) tags.push('project');
  if (/error|broke|failed|fix|bug/i.test(t)) tags.push('error');
  if (/person|contact|friend|family|son|wife/i.test(t)) tags.push('person');
  if (/rule|must|never|every|always/i.test(t)) tags.push('rule');
  if (/boat|catana|yanmar|signalk|engine|battery/i.test(t)) tags.push('boat');
  if (/youtube|channel|video|content/i.test(t)) tags.push('content');
  if (tags.length === 0) tags.push('fact');
  return tags;
}

function inferImportance(text) {
  const t = text.toLowerCase();
  if (/permanent|standing order|never|critical|must|rule:/i.test(t)) return 9;
  if (/prefer|every project|always|important/i.test(t)) return 7;
  if (/contact|family|son/i.test(t)) return 6;
  return 5;
}

// ── ADMIN ─────────────────────────────────────────────────────────────────────

export async function getMemoryStats(jid) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE importance >= 8) as critical,
       COUNT(*) FILTER (WHERE source = 'auto') as auto_extracted,
       COUNT(*) FILTER (WHERE source = 'seed') as seeded,
       MAX(created_at) as newest,
       MIN(created_at) as oldest
     FROM episodic_memories
     WHERE jid = $1 AND is_active = TRUE`,
    [jid]
  );
  return rows[0];
}

export async function listMemories(jid, { tag, limit = 30 } = {}) {
  let query = `SELECT id, summary, tags, importance, created_at, access_count
               FROM episodic_memories WHERE jid = $1 AND is_active = TRUE`;
  const params = [jid];
  if (tag) {
    query += ` AND $2 = ANY(tags)`;
    params.push(tag);
  }
  query += ` ORDER BY importance DESC, last_accessed DESC LIMIT ${limit}`;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function deleteMemory(id, jid) {
  await pool.query(
    `UPDATE episodic_memories SET is_active = FALSE WHERE id = $1 AND jid = $2`,
    [id, jid]
  );
}

export async function clearMemories(jid) {
  await pool.query(
    `UPDATE episodic_memories SET is_active = FALSE WHERE jid = $1`, [jid]
  );
  await pool.query('DELETE FROM memory_seeds WHERE jid = $1', [jid]);
}

export { pool as memoryPool };
