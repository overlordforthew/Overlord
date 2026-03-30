/**
 * Fix Patterns — Learn from successful repairs, suggest fixes for similar future errors
 *
 * Stores fix patterns extracted from successful repair tasks.
 * Before each autonomous task, queries for matching patterns to inject as hints.
 */

import pg from 'pg';
import pino from 'pino';
import { callWithFallback } from './router.js';
import { parseJsonFromLLM } from './lib/parse-json-llm.js';

const logger = pino({ level: 'info' });

let pool = null;
let initialized = false;
let initPromise = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS fix_patterns (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  project         TEXT,
  category        TEXT,
  symptom_pattern TEXT NOT NULL,
  symptom_keywords TEXT[] DEFAULT '{}',
  root_cause      TEXT,
  fix_description TEXT NOT NULL,
  success_count   INTEGER DEFAULT 1,
  failure_count   INTEGER DEFAULT 0,
  last_used_at    TIMESTAMPTZ,
  search_vector   TSVECTOR
);

CREATE INDEX IF NOT EXISTS idx_fix_search ON fix_patterns USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_fix_keywords ON fix_patterns USING GIN (symptom_keywords);
CREATE INDEX IF NOT EXISTS idx_fix_project ON fix_patterns (project);

-- Auto-update search vector
CREATE OR REPLACE FUNCTION fix_patterns_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', COALESCE(NEW.symptom_pattern, '') || ' ' || COALESCE(NEW.root_cause, '') || ' ' || COALESCE(NEW.fix_description, '') || ' ' || COALESCE(NEW.project, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS fix_patterns_search_trigger ON fix_patterns;
CREATE TRIGGER fix_patterns_search_trigger
  BEFORE INSERT OR UPDATE ON fix_patterns
  FOR EACH ROW EXECUTE FUNCTION fix_patterns_search_update();
`;

export async function initFixPatterns() {
  if (initialized) return true;
  if (initPromise) return initPromise;

  initPromise = _doInit();
  return initPromise;
}

async function _doInit() {
  const host = process.env.CONV_DB_HOST || 'overlord-db';
  const port = parseInt(process.env.CONV_DB_PORT || '5432');
  const database = process.env.CONV_DB_NAME || 'overlord';
  const user = process.env.CONV_DB_USER || 'overlord';
  const password = process.env.CONV_DB_PASS;

  if (!password) { initPromise = null; return false; }

  try {
    pool = new pg.Pool({
      host, port, database, user, password,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const client = await pool.connect();
    try {
      // Advisory lock prevents concurrent schema init deadlocks
      await client.query('SELECT pg_advisory_lock(299792458)');
      await client.query(SCHEMA);
      await client.query('SELECT pg_advisory_unlock(299792458)');
    } finally {
      client.release();
    }

    initialized = true;
    logger.info('🔧 Fix patterns initialized');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Fix patterns init failed');
    pool = null;
    initPromise = null;
    return false;
  }
}

export async function findMatchingPatterns(symptomText, project = null) {
  if (!initialized || !pool || !symptomText) return [];

  try {
    // Full-text search with optional project filter
    const query = project
      ? `SELECT symptom_pattern, root_cause, fix_description, success_count, failure_count, project
         FROM fix_patterns
         WHERE search_vector @@ plainto_tsquery('english', $1)
           AND (project = $2 OR project IS NULL)
           AND success_count > failure_count
         ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC, success_count DESC
         LIMIT 3`
      : `SELECT symptom_pattern, root_cause, fix_description, success_count, failure_count, project
         FROM fix_patterns
         WHERE search_vector @@ plainto_tsquery('english', $1)
           AND success_count > failure_count
         ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC, success_count DESC
         LIMIT 3`;

    const params = project ? [symptomText.substring(0, 500), project] : [symptomText.substring(0, 500)];
    const { rows } = await pool.query(query, params);

    // Update last_used_at for matches
    if (rows.length > 0) {
      const ids = rows.map((_, i) => `$${i + 1}`).join(',');
      // Fire and forget
      pool.query(
        `UPDATE fix_patterns SET last_used_at = NOW() WHERE symptom_pattern = ANY($1)`,
        [rows.map(r => r.symptom_pattern)]
      ).catch(() => {});
    }

    return rows;
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to find fix patterns');
    return [];
  }
}

export async function storeFixPattern({ project, category, symptomPattern, rootCause, fixDescription, keywords = [] }) {
  if (!fixDescription) {
    logger.warn('Skipping fix pattern storage: fixDescription is null');
    return;
  }
  if (!initialized || !pool) return;
  if (!symptomPattern || !fixDescription) return;

  try {
    // Check for existing similar pattern
    const { rows: existing } = await pool.query(
      `SELECT id FROM fix_patterns
       WHERE search_vector @@ plainto_tsquery('english', $1)
         AND (project = $2 OR project IS NULL)
       ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
       LIMIT 1`,
      [symptomPattern.substring(0, 300), project]
    );

    if (existing.length > 0) {
      // Boost existing pattern instead of creating duplicate
      await pool.query(
        `UPDATE fix_patterns SET success_count = success_count + 1, last_used_at = NOW() WHERE id = $1`,
        [existing[0].id]
      );
      return;
    }

    await pool.query(
      `INSERT INTO fix_patterns (project, category, symptom_pattern, symptom_keywords, root_cause, fix_description)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [project, category, symptomPattern, keywords, rootCause, fixDescription]
    );
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to store fix pattern');
  }
}

export async function recordPatternFailure(symptomText) {
  if (!initialized || !pool) return;

  try {
    await pool.query(
      `UPDATE fix_patterns SET failure_count = failure_count + 1
       WHERE search_vector @@ plainto_tsquery('english', $1)`,
      [symptomText.substring(0, 300)]
    );
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to record pattern failure');
  }
}

export async function extractFixPattern(taskTitle, responseText) {
  if (!responseText || responseText.length < 50) return null;

  try {
    const prompt = `Extract a fix pattern from this successful repair. Return ONLY valid JSON, no markdown:
{
  "project": "project name or null",
  "category": "container|network|database|auth|deploy|code|config",
  "symptom": "what the error/symptom looked like (1-2 sentences)",
  "rootCause": "what actually caused it (1-2 sentences)",
  "fix": "what fixed it (1-2 sentences)",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}

Task: ${taskTitle}
Response: ${responseText.substring(0, 1000)}`;

    const { response: result } = await callWithFallback(
      ['gemini-flash', 'gemini-flash-lite'],
      'You extract structured fix patterns from repair logs. Return ONLY valid JSON.',
      prompt,
      500,
      { jsonMode: true }
    );

    const parsed = parseJsonFromLLM(result);
    if (!parsed) throw new Error('No valid JSON found in LLM response');
    return parsed;
  } catch (err) {
    logger.warn({ err: err.message }, 'Fix pattern extraction failed');
    return null;
  }
}

export async function pruneStalePatterns() {
  if (!initialized || !pool) return;

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM fix_patterns
       WHERE success_count = 0 AND failure_count >= 3
         AND created_at < NOW() - INTERVAL '30 days'`
    );
    if (rowCount > 0) {
      logger.info({ pruned: rowCount }, 'Pruned stale fix patterns');
    }
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to prune fix patterns');
  }
}

export function formatPatternsForPrompt(patterns) {
  if (!patterns || patterns.length === 0) return '';

  const lines = ['[KNOWN FIX PATTERNS — similar issues resolved before]'];
  for (const p of patterns) {
    lines.push(`- Symptom: ${p.symptom_pattern}`);
    if (p.root_cause) lines.push(`  Root cause: ${p.root_cause}`);
    lines.push(`  Fix: ${p.fix_description} (worked ${p.success_count}x)`);
    lines.push('');
  }
  lines.push('Consider these patterns but verify they apply to the current issue.');
  return lines.join('\n');
}
