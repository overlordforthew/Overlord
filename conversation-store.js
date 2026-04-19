/**
 * Conversation Store — Training Data Collection
 *
 * Stores every conversation turn (user input → assistant output) in PostgreSQL
 * for future LoRA fine-tuning. Captures full context including system prompt,
 * conversation history, model used, and metadata.
 *
 * Schema designed for ML training pipelines:
 * - Each row = one complete turn (prompt + completion)
 * - Includes the full context window that was fed to the model
 * - Tagged with model, router mode, task type for filtering training sets
 */

import pg from 'pg';
import pino from 'pino';

const logger = pino({ level: 'info' });

let pool = null;
let initialized = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS conversations (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Who / where
  chat_jid        TEXT NOT NULL,
  sender_jid      TEXT NOT NULL,
  sender_name     TEXT,
  chat_type       TEXT NOT NULL DEFAULT 'dm',  -- 'dm' or 'group'

  -- User input
  user_message    TEXT NOT NULL,
  message_type    TEXT DEFAULT 'text',          -- text, image, audio, document, etc.
  quoted_text     TEXT,                         -- if replying to something
  media_path      TEXT,                         -- path to attached media
  transcription   TEXT,                         -- voice note transcription

  -- Context fed to model
  system_prompt   TEXT,                         -- full system prompt used
  conversation_context TEXT,                    -- recent messages fed as context
  memory_snapshot TEXT,                         -- memory.md contents at time of call

  -- Model output
  assistant_response TEXT NOT NULL,

  -- Routing metadata
  model_id        TEXT NOT NULL,                -- e.g. claude-opus-4-7, claude-sonnet-4-6
  router_mode     TEXT,                         -- alpha, beta, charlie
  task_type       TEXT,                         -- complex, simple, conversational, etc.
  route_via       TEXT,                         -- claude-cli, openrouter-api, gemini-api

  -- Performance
  response_time_ms INTEGER,
  token_estimate   INTEGER,                     -- rough token count of full prompt

  -- Training labels (can be updated later)
  quality_score   SMALLINT,                     -- 1-5 manual rating (null = unrated)
  flagged         BOOLEAN DEFAULT FALSE,        -- flag for review
  flag_reason     TEXT,
  tags            TEXT[] DEFAULT '{}'            -- custom tags for filtering training sets
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_chat ON conversations (chat_jid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_model ON conversations (model_id);
CREATE INDEX IF NOT EXISTS idx_conv_quality ON conversations (quality_score) WHERE quality_score IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conv_flagged ON conversations (flagged) WHERE flagged = TRUE;
CREATE INDEX IF NOT EXISTS idx_conv_tags ON conversations USING GIN (tags);
`;

/**
 * Initialize the conversation store connection pool.
 * Reads config from environment variables.
 */
export async function initConversationStore() {
  if (initialized) return true;

  const host = process.env.CONV_DB_HOST || 'overlord-db';
  const port = parseInt(process.env.CONV_DB_PORT || '5432');
  const database = process.env.CONV_DB_NAME || 'overlord';
  const user = process.env.CONV_DB_USER || 'overlord';
  const password = process.env.CONV_DB_PASS;

  if (!password) {
    logger.warn('CONV_DB_PASS not set — conversation store disabled');
    return false;
  }

  try {
    pool = new pg.Pool({
      host, port, database, user, password,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Test connection
    const client = await pool.connect();
    await client.query('SELECT 1');

    // Create schema
    await client.query(SCHEMA);
    client.release();

    initialized = true;
    logger.info({ host, database }, '🗄️ Conversation store initialized');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, '🗄️ Conversation store init failed — logging disabled');
    pool = null;
    return false;
  }
}

/**
 * Log a complete conversation turn (user input + assistant response).
 * Non-blocking — errors are logged but never thrown.
 */
export async function logConversation({
  chatJid,
  senderJid,
  senderName,
  chatType,
  userMessage,
  messageType,
  quotedText,
  mediaPath,
  transcription,
  systemPrompt,
  conversationContext,
  memorySnapshot,
  assistantResponse,
  modelId,
  routerMode,
  taskType,
  routeVia,
  responseTimeMs,
}) {
  if (!initialized || !pool) return;

  try {
    // Rough token estimate: ~4 chars per token
    const fullPromptLength = (systemPrompt || '').length + (conversationContext || '').length +
                              (memorySnapshot || '').length + (userMessage || '').length;
    const tokenEstimate = Math.round(fullPromptLength / 4);

    await pool.query(`
      INSERT INTO conversations (
        chat_jid, sender_jid, sender_name, chat_type,
        user_message, message_type, quoted_text, media_path, transcription,
        system_prompt, conversation_context, memory_snapshot,
        assistant_response,
        model_id, router_mode, task_type, route_via,
        response_time_ms, token_estimate
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
    `, [
      chatJid, senderJid, senderName, chatType,
      userMessage, messageType, quotedText, mediaPath, transcription,
      systemPrompt, conversationContext, memorySnapshot,
      assistantResponse,
      modelId, routerMode, taskType, routeVia,
      responseTimeMs, tokenEstimate,
    ]);
  } catch (err) {
    logger.error({ err: err.message }, '🗄️ Failed to log conversation');
  }
}

/**
 * Get conversation stats.
 */
export async function getConversationStats() {
  if (!initialized || !pool) return null;

  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT chat_jid) as unique_chats,
        COUNT(DISTINCT model_id) as models_used,
        MIN(created_at) as first_logged,
        MAX(created_at) as last_logged,
        COUNT(*) FILTER (WHERE quality_score IS NOT NULL) as rated,
        ROUND(AVG(response_time_ms)) as avg_response_ms,
        pg_size_pretty(pg_total_relation_size('conversations')) as db_size
      FROM conversations
    `);
    return result.rows[0];
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get conversation stats');
    return null;
  }
}

/**
 * Export conversations in training-ready format (JSONL).
 * Returns array of {system, user, assistant} objects.
 */
export async function exportTrainingData({
  minQuality = null,
  modelFilter = null,
  limit = 10000,
  since = null,
} = {}) {
  if (!initialized || !pool) return [];

  let query = `
    SELECT system_prompt, conversation_context, memory_snapshot,
           user_message, assistant_response, model_id, task_type, tags
    FROM conversations
    WHERE TRUE
  `;
  const params = [];
  let paramIdx = 1;

  if (minQuality !== null) {
    query += ` AND quality_score >= $${paramIdx++}`;
    params.push(minQuality);
  }
  if (modelFilter) {
    query += ` AND model_id = $${paramIdx++}`;
    params.push(modelFilter);
  }
  if (since) {
    query += ` AND created_at >= $${paramIdx++}`;
    params.push(since);
  }

  query += ` ORDER BY created_at ASC LIMIT $${paramIdx}`;
  params.push(limit);

  const result = await pool.query(query, params);

  return result.rows.map(row => ({
    system: [row.system_prompt, row.memory_snapshot, row.conversation_context].filter(Boolean).join('\n\n'),
    user: row.user_message,
    assistant: row.assistant_response,
    metadata: { model: row.model_id, task_type: row.task_type, tags: row.tags },
  }));
}

/**
 * Load recent conversation context from DB for a given chat.
 * Used as fallback when context.json file is missing (e.g. after restart).
 */
export async function getRecentConversations(chatJid, limit = 20) {
  if (!pool || !initialized) return [];
  try {
    const { rows } = await pool.query(
      `SELECT sender_name, user_message, assistant_response, created_at
       FROM conversations
       WHERE chat_jid = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [chatJid, limit]
    );
    // Return in chronological order
    return rows.reverse().flatMap(r => {
      const entries = [];
      if (r.user_message) {
        entries.push({
          timestamp: r.created_at?.toISOString(),
          sender: r.sender_name || 'user',
          senderName: r.sender_name || 'user',
          role: 'user',
          type: 'text',
          text: r.user_message,
        });
      }
      if (r.assistant_response) {
        entries.push({
          timestamp: r.created_at?.toISOString(),
          sender: 'bot',
          senderName: 'Overlord',
          role: 'bot',
          type: 'text',
          text: r.assistant_response,
        });
      }
      return entries;
    });
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to load recent conversations from DB');
    return [];
  }
}

/**
 * Graceful shutdown.
 */
export async function closeConversationStore() {
  if (pool) {
    await pool.end();
    initialized = false;
    logger.info('🗄️ Conversation store closed');
  }
}
