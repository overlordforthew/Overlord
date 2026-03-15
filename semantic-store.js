/**
 * Overlord Semantic + Procedural Memory Store
 * Global system knowledge (tools, infrastructure, APIs, configs)
 * and how-to procedures (deployment, debugging, ops patterns).
 *
 * Uses the same PostgreSQL "overlord" database as episodic memories.
 */

import pg from 'pg';
import { readFileSync } from 'fs';

// Reuse the same DB credentials as memory-store.js
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
  console.error('[semantic-store] Pool error:', err.message);
});

// ── SCHEMA ────────────────────────────────────────────────────────────────────

export async function ensureSemanticSchema() {
  const client = await pool.connect();
  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    // Semantic memories — global system knowledge
    await client.query(`
      CREATE TABLE IF NOT EXISTS semantic_memories (
        id SERIAL PRIMARY KEY,
        category TEXT NOT NULL,
        topic TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        importance REAL DEFAULT 0.5,
        confidence REAL DEFAULT 1.0,
        source TEXT DEFAULT 'manual',
        tags TEXT[] DEFAULT '{}',
        project TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_accessed TIMESTAMPTZ DEFAULT NOW(),
        access_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        superseded_by INTEGER REFERENCES semantic_memories(id)
      )
    `);

    // Add search_vector column if missing (generated column)
    const { rows: svCol } = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'semantic_memories' AND column_name = 'search_vector'
    `);
    if (!svCol.length) {
      await client.query(`
        ALTER TABLE semantic_memories ADD COLUMN search_vector TSVECTOR
        GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce(topic, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
          setweight(to_tsvector('english', coalesce(content, '')), 'C') ||
          setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'B')
        ) STORED
      `);
    }

    await client.query(`CREATE INDEX IF NOT EXISTS idx_semantic_category ON semantic_memories(category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_semantic_topic ON semantic_memories(topic)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_semantic_project ON semantic_memories(project)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_semantic_tags ON semantic_memories USING gin(tags)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_semantic_fts ON semantic_memories USING gin(search_vector)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_semantic_importance ON semantic_memories(importance DESC)`);

    // Procedural memories — how-to patterns
    await client.query(`
      CREATE TABLE IF NOT EXISTS procedural_memories (
        id SERIAL PRIMARY KEY,
        trigger_pattern TEXT NOT NULL,
        procedure TEXT NOT NULL,
        category TEXT DEFAULT 'ops',
        project TEXT,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        last_used TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        is_active BOOLEAN DEFAULT TRUE
      )
    `);

    const { rows: pvCol } = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'procedural_memories' AND column_name = 'search_vector'
    `);
    if (!pvCol.length) {
      await client.query(`
        ALTER TABLE procedural_memories ADD COLUMN search_vector TSVECTOR
        GENERATED ALWAYS AS (
          setweight(to_tsvector('english', coalesce(trigger_pattern, '')), 'A') ||
          setweight(to_tsvector('english', coalesce(procedure, '')), 'C')
        ) STORED
      `);
    }

    await client.query(`CREATE INDEX IF NOT EXISTS idx_procedural_category ON procedural_memories(category)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_procedural_fts ON procedural_memories USING gin(search_vector)`);

    // Memory associations — cross-type links
    await client.query(`
      CREATE TABLE IF NOT EXISTS memory_associations (
        id SERIAL PRIMARY KEY,
        source_type TEXT NOT NULL CHECK(source_type IN ('semantic', 'episodic', 'procedural')),
        source_id INTEGER NOT NULL,
        target_type TEXT NOT NULL CHECK(target_type IN ('semantic', 'episodic', 'procedural')),
        target_id INTEGER NOT NULL,
        relationship TEXT NOT NULL CHECK(relationship IN ('related_to', 'depends_on', 'contradicts', 'supersedes', 'part_of')),
        strength REAL DEFAULT 0.5 CHECK(strength BETWEEN 0 AND 1),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(source_type, source_id, target_type, target_id, relationship)
      )
    `);
  } finally {
    client.release();
  }
}

// ── SEMANTIC CRUD ─────────────────────────────────────────────────────────────

export async function saveSemantic({ category, topic, content, summary, importance = 0.5, confidence = 1.0, source = 'manual', tags = [], project = null }) {
  // Dedup: update if same category+topic exists and content is similar
  const { rows: existing } = await pool.query(
    `SELECT id, content FROM semantic_memories
     WHERE category = $1 AND topic = $2 AND is_active = TRUE
     ORDER BY importance DESC LIMIT 1`,
    [category, topic]
  );

  if (existing.length) {
    // Update existing entry
    const { rows } = await pool.query(
      `UPDATE semantic_memories
       SET content = $1, summary = $2, importance = GREATEST(importance, $3),
           confidence = $4, source = $5, tags = $6, project = $7, updated_at = NOW()
       WHERE id = $8
       RETURNING id`,
      [content.trim(), summary || content.trim().slice(0, 60), importance, confidence, source, tags, project, existing[0].id]
    );
    return rows[0].id;
  }

  const { rows } = await pool.query(
    `INSERT INTO semantic_memories (category, topic, content, summary, importance, confidence, source, tags, project)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [category, topic, content.trim(), summary || content.trim().slice(0, 60), importance, confidence, source, tags, project]
  );
  return rows[0].id;
}

export async function updateSemantic(id, content) {
  await pool.query(
    `UPDATE semantic_memories SET content = $1, summary = $2, updated_at = NOW() WHERE id = $3`,
    [content.trim(), content.trim().slice(0, 60), id]
  );
}

export async function getSemantic(id) {
  const { rows } = await pool.query(
    `SELECT * FROM semantic_memories WHERE id = $1`, [id]
  );
  return rows[0] || null;
}

export async function forgetSemantic(id) {
  await pool.query(
    `UPDATE semantic_memories SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]
  );
}

export async function strengthenSemantic(id) {
  await pool.query(
    `UPDATE semantic_memories SET importance = LEAST(importance + 0.1, 1.0), updated_at = NOW() WHERE id = $1`, [id]
  );
}

export async function weakenSemantic(id) {
  await pool.query(
    `UPDATE semantic_memories SET importance = GREATEST(importance - 0.1, 0.1), updated_at = NOW() WHERE id = $1`, [id]
  );
}

// ── SEARCH ────────────────────────────────────────────────────────────────────

export async function searchSemantic(query, { limit = 10, category = null } = {}) {
  let sql = `
    SELECT id, category, topic, content, summary, importance, confidence, source, tags, project,
           created_at, updated_at, last_accessed, access_count,
           ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
    FROM semantic_memories
    WHERE is_active = TRUE
      AND (search_vector @@ plainto_tsquery('english', $1) OR topic ILIKE '%' || $1 || '%' OR content ILIKE '%' || $1 || '%')
  `;
  const params = [query];

  if (category) {
    sql += ` AND category = $${params.length + 1}`;
    params.push(category);
  }

  sql += ` ORDER BY rank DESC, importance DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query(sql, params);

  // Update access stats
  if (rows.length) {
    const ids = rows.map(r => r.id);
    await pool.query(
      `UPDATE semantic_memories SET last_accessed = NOW(), access_count = access_count + 1 WHERE id = ANY($1)`,
      [ids]
    );
  }

  return rows;
}

export async function recallByCategory(category, { topic = null, limit = 20 } = {}) {
  let sql = `SELECT id, category, topic, content, summary, importance, tags, project, access_count
             FROM semantic_memories WHERE is_active = TRUE AND category = $1`;
  const params = [category];

  if (topic) {
    sql += ` AND topic = $${params.length + 1}`;
    params.push(topic);
  }

  sql += ` ORDER BY importance DESC, access_count DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const { rows } = await pool.query(sql, params);
  return rows;
}

// ── SEMANTIC CONTEXT FOR PROMPT INJECTION ─────────────────────────────────────

export async function getSemanticContext(query) {
  if (!query || query.length < 3) return '';

  try {
    const results = await searchSemantic(query, { limit: 10 });
    if (!results.length) return '';

    const lines = ['## System Knowledge'];
    for (const r of results) {
      const prefix = r.importance >= 0.8 ? '**' : '';
      const suffix = r.importance >= 0.8 ? '**' : '';
      lines.push(`- ${prefix}[${r.category}/${r.topic}]${suffix} ${r.content}`);
    }
    return lines.join('\n');
  } catch (err) {
    console.error('[semantic-store] Context retrieval failed:', err.message);
    return '';
  }
}

// ── PROCEDURAL CRUD ───────────────────────────────────────────────────────────

export async function saveProcedural({ trigger_pattern, procedure, category = 'ops', project = null }) {
  const { rows } = await pool.query(
    `INSERT INTO procedural_memories (trigger_pattern, procedure, category, project)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [trigger_pattern, procedure, category, project]
  );
  return rows[0].id;
}

export async function searchProcedural(query, { limit = 10 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, trigger_pattern, procedure, category, project, success_count, failure_count, last_used
     FROM procedural_memories
     WHERE is_active = TRUE
       AND (search_vector @@ plainto_tsquery('english', $1) OR trigger_pattern ILIKE '%' || $1 || '%')
     ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC,
              (success_count - failure_count) DESC
     LIMIT $2`,
    [query, limit]
  );
  return rows;
}

export async function listProcedural({ limit = 20 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, trigger_pattern, procedure, category, project, success_count, failure_count, last_used
     FROM procedural_memories WHERE is_active = TRUE
     ORDER BY (success_count - failure_count) DESC, created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function recordProceduralOutcome(id, success) {
  const col = success ? 'success_count' : 'failure_count';
  await pool.query(
    `UPDATE procedural_memories SET ${col} = ${col} + 1, last_used = NOW(), updated_at = NOW() WHERE id = $1`,
    [id]
  );
}

// ── ASSOCIATIONS ──────────────────────────────────────────────────────────────

export async function createAssociation({ source_type, source_id, target_type, target_id, relationship, strength = 0.5 }) {
  const { rows } = await pool.query(
    `INSERT INTO memory_associations (source_type, source_id, target_type, target_id, relationship, strength)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_type, source_id, target_type, target_id, relationship)
     DO UPDATE SET strength = EXCLUDED.strength
     RETURNING id`,
    [source_type, source_id, target_type, target_id, relationship, strength]
  );
  return rows[0].id;
}

export async function getAssociations(type, id) {
  const { rows } = await pool.query(
    `SELECT * FROM memory_associations
     WHERE (source_type = $1 AND source_id = $2) OR (target_type = $1 AND target_id = $2)
     ORDER BY strength DESC`,
    [type, id]
  );
  return rows;
}

// ── STATS ─────────────────────────────────────────────────────────────────────

export async function getSemanticStats() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM semantic_memories WHERE is_active = TRUE) as semantic_total,
      (SELECT COUNT(*) FROM procedural_memories WHERE is_active = TRUE) as procedural_total,
      (SELECT COUNT(*) FROM memory_associations) as association_total,
      (SELECT COUNT(DISTINCT category) FROM semantic_memories WHERE is_active = TRUE) as categories,
      (SELECT COUNT(DISTINCT topic) FROM semantic_memories WHERE is_active = TRUE) as topics,
      (SELECT AVG(importance) FROM semantic_memories WHERE is_active = TRUE) as avg_importance,
      (SELECT MAX(updated_at) FROM semantic_memories) as last_updated
  `);
  return rows[0];
}

export async function getCategoryBreakdown() {
  const { rows } = await pool.query(`
    SELECT category, COUNT(*) as count, ROUND(AVG(importance)::numeric, 2) as avg_importance
    FROM semantic_memories WHERE is_active = TRUE
    GROUP BY category ORDER BY count DESC
  `);
  return rows;
}

export { pool as semanticPool };
