/**
 * Knowledge Base (#5) — Persistent searchable knowledge store
 *
 * Auto-indexes documents, links, and voice notes sent in chat.
 * Full-text search via PostgreSQL tsvector.
 * /kb search <query>, /kb recent, /kb stats
 */

import pg from 'pg';
import pino from 'pino';

const logger = pino({ level: 'info' });

let pool = null;
let initialized = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS knowledge_base (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type            TEXT NOT NULL,  -- document, link, voice, note, research
  title           TEXT,
  content         TEXT NOT NULL,
  summary         TEXT,
  source_url      TEXT,
  source_jid      TEXT,
  source_chat     TEXT,
  tags            TEXT[] DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  search_vector   TSVECTOR
);

CREATE INDEX IF NOT EXISTS idx_kb_search ON knowledge_base USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_kb_type ON knowledge_base (type);
CREATE INDEX IF NOT EXISTS idx_kb_created ON knowledge_base (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_tags ON knowledge_base USING GIN (tags);

CREATE OR REPLACE FUNCTION kb_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    COALESCE(NEW.title, '') || ' ' ||
    COALESCE(NEW.content, '') || ' ' ||
    COALESCE(NEW.summary, '') || ' ' ||
    COALESCE(array_to_string(NEW.tags, ' '), '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS kb_search_trigger ON knowledge_base;
CREATE TRIGGER kb_search_trigger
  BEFORE INSERT OR UPDATE ON knowledge_base
  FOR EACH ROW EXECUTE FUNCTION kb_search_update();
`;

export async function initKnowledgeBase() {
  if (initialized) return true;
  const password = process.env.CONV_DB_PASS;
  if (!password) return false;

  try {
    pool = new pg.Pool({
      host: process.env.CONV_DB_HOST || 'overlord-db',
      port: parseInt(process.env.CONV_DB_PORT || '5432'),
      database: process.env.CONV_DB_NAME || 'overlord',
      user: process.env.CONV_DB_USER || 'overlord',
      password,
      max: 3, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
    });
    const client = await pool.connect();
    await client.query(SCHEMA);
    client.release();
    initialized = true;
    logger.info('📚 Knowledge base initialized');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Knowledge base init failed');
    return false;
  }
}

export async function ingest({ type, title, content, summary, sourceUrl, sourceJid, sourceChat, tags = [], metadata = {} }) {
  if (!initialized || !pool || !content) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO knowledge_base (type, title, content, summary, source_url, source_jid, source_chat, tags, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [type, title, content.substring(0, 50000), summary, sourceUrl, sourceJid, sourceChat, tags, JSON.stringify(metadata)]
    );
    logger.info({ id: rows[0].id, type, title }, 'Ingested into knowledge base');
    return rows[0].id;
  } catch (err) {
    logger.error({ err: err.message }, 'KB ingest failed');
    return null;
  }
}

export async function search(query, limit = 5) {
  if (!initialized || !pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, summary, LEFT(content, 300) as excerpt, tags, created_at,
              ts_rank(search_vector, plainto_tsquery('english', $1)) as rank
       FROM knowledge_base
       WHERE search_vector @@ plainto_tsquery('english', $1)
       ORDER BY rank DESC, created_at DESC
       LIMIT $2`,
      [query, limit]
    );
    return rows;
  } catch (err) {
    logger.error({ err: err.message }, 'KB search failed');
    return [];
  }
}

export async function getRecent(limit = 10) {
  if (!initialized || !pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, type, title, LEFT(summary, 200) as summary, tags, created_at
       FROM knowledge_base ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    return rows;
  } catch (err) { return []; }
}

export async function getStats() {
  if (!initialized || !pool) return null;
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) as total,
        COUNT(*) FILTER (WHERE type = 'document') as documents,
        COUNT(*) FILTER (WHERE type = 'link') as links,
        COUNT(*) FILTER (WHERE type = 'voice') as voice,
        COUNT(*) FILTER (WHERE type = 'research') as research,
        COUNT(*) FILTER (WHERE type = 'note') as notes,
        pg_size_pretty(pg_total_relation_size('knowledge_base')) as db_size
      FROM knowledge_base
    `);
    return rows[0];
  } catch (err) { return null; }
}

export function formatSearchResults(results) {
  if (!results || results.length === 0) return 'No results found.';
  return results.map((r, i) => {
    const date = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const tags = r.tags?.length ? ` [${r.tags.join(', ')}]` : '';
    return `${i + 1}. *${r.title || r.type}* (${date})${tags}\n   ${r.summary || r.excerpt || '(no summary)'}`;
  }).join('\n\n');
}

export function formatStats(stats) {
  if (!stats) return 'Knowledge base not available.';
  return [
    '📚 *Knowledge Base*',
    `Total entries: ${stats.total}`,
    `Documents: ${stats.documents} | Links: ${stats.links} | Research: ${stats.research}`,
    `Voice: ${stats.voice} | Notes: ${stats.notes}`,
    `Size: ${stats.db_size}`,
  ].join('\n');
}
