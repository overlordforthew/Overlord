/**
 * Usage Tracker — Per-interaction token/cost tracking
 *
 * Tracks model usage, estimated token counts, and costs.
 * Provides /cost command data: today by model, week by user, trends.
 */

import pg from 'pg';
import pino from 'pino';

const logger = pino({ level: 'info' });

let pool = null;
let initialized = false;

// Cost rates per million tokens (input/output)
const COST_RATES = {
  'claude-opus-4-6':     { input: 5.00,  output: 25.00 },
  'claude-sonnet-4-6':   { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5':    { input: 1.00,  output: 5.00 },
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_stats (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  chat_jid        TEXT NOT NULL,
  sender_jid      TEXT NOT NULL,
  model_id        TEXT NOT NULL,
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  estimated_cost_usd NUMERIC(10,6) DEFAULT 0,
  response_time_ms INTEGER DEFAULT 0,
  task_type       TEXT,
  route_via       TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_stats (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_stats (model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_sender ON usage_stats (sender_jid, created_at DESC);
`;

export async function initUsageTracker() {
  if (initialized) return true;

  const host = process.env.CONV_DB_HOST || 'overlord-db';
  const port = parseInt(process.env.CONV_DB_PORT || '5432');
  const database = process.env.CONV_DB_NAME || 'overlord';
  const user = process.env.CONV_DB_USER || 'overlord';
  const password = process.env.CONV_DB_PASS;

  if (!password) return false;

  try {
    pool = new pg.Pool({
      host, port, database, user, password,
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const client = await pool.connect();
    await client.query(SCHEMA);
    client.release();

    initialized = true;
    logger.info('📊 Usage tracker initialized');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Usage tracker init failed');
    pool = null;
    return false;
  }
}

function estimateCost(modelId, inputTokens, outputTokens) {
  const rates = COST_RATES[modelId];
  if (!rates) return 0; // Free models
  return (inputTokens / 1_000_000 * rates.input) + (outputTokens / 1_000_000 * rates.output);
}

export async function logUsage({ chatJid, senderJid, modelId, promptLength, responseLength, responseTimeMs, taskType, routeVia }) {
  if (!initialized || !pool) return;

  try {
    const inputTokens = Math.round((promptLength || 0) / 4);
    const outputTokens = Math.round((responseLength || 0) / 4);
    const cost = estimateCost(modelId, inputTokens, outputTokens);

    await pool.query(`
      INSERT INTO usage_stats (chat_jid, sender_jid, model_id, input_tokens, output_tokens, estimated_cost_usd, response_time_ms, task_type, route_via)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [chatJid, senderJid, modelId, inputTokens, outputTokens, cost, responseTimeMs, taskType, routeVia]);
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to log usage');
  }
}

export async function getTodayUsage() {
  if (!initialized || !pool) return null;

  try {
    const { rows } = await pool.query(`
      SELECT
        model_id,
        COUNT(*) as calls,
        SUM(input_tokens) as total_input,
        SUM(output_tokens) as total_output,
        SUM(estimated_cost_usd) as total_cost,
        ROUND(AVG(response_time_ms)) as avg_response_ms
      FROM usage_stats
      WHERE created_at >= CURRENT_DATE
      GROUP BY model_id
      ORDER BY total_cost DESC
    `);
    return rows;
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get today usage');
    return null;
  }
}

export async function getWeekUsage() {
  if (!initialized || !pool) return null;

  try {
    const { rows } = await pool.query(`
      SELECT
        sender_jid,
        COUNT(*) as calls,
        SUM(estimated_cost_usd) as total_cost,
        ROUND(AVG(response_time_ms)) as avg_response_ms
      FROM usage_stats
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY sender_jid
      ORDER BY total_cost DESC
    `);
    return rows;
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get week usage');
    return null;
  }
}

export async function getCostTrend() {
  if (!initialized || !pool) return null;

  try {
    const { rows } = await pool.query(`
      SELECT
        created_at::date as day,
        COUNT(*) as calls,
        SUM(estimated_cost_usd) as total_cost,
        ROUND(AVG(response_time_ms)) as avg_response_ms
      FROM usage_stats
      WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY created_at::date
      ORDER BY day DESC
    `);
    return rows;
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to get cost trend');
    return null;
  }
}

export function formatCostReport(today, week, trend) {
  const lines = ['📊 *Usage & Cost Dashboard*\n'];

  if (today && today.length > 0) {
    lines.push('*Today by Model:*');
    let totalCost = 0;
    for (const r of today) {
      const modelName = r.model_id.replace('claude-', '').replace(/-\d+-\d+$/, '');
      const cost = parseFloat(r.total_cost) || 0;
      totalCost += cost;
      lines.push(`  ${modelName}: ${r.calls} calls, ~${Math.round(r.total_input/1000)}K in / ${Math.round(r.total_output/1000)}K out, $${cost.toFixed(4)}, avg ${r.avg_response_ms}ms`);
    }
    lines.push(`  *Total today: $${totalCost.toFixed(4)}*`);
  } else {
    lines.push('*Today:* No usage yet');
  }

  lines.push('');

  if (week && week.length > 0) {
    lines.push('*This Week by User:*');
    for (const r of week) {
      const user = r.sender_jid.replace(/@.*/, '');
      const cost = parseFloat(r.total_cost) || 0;
      lines.push(`  ${user}: ${r.calls} calls, $${cost.toFixed(4)}, avg ${r.avg_response_ms}ms`);
    }
  }

  lines.push('');

  if (trend && trend.length > 0) {
    lines.push('*7-Day Trend:*');
    for (const r of trend) {
      const day = new Date(r.day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const cost = parseFloat(r.total_cost) || 0;
      lines.push(`  ${day}: ${r.calls} calls, $${cost.toFixed(4)}`);
    }
  }

  return lines.join('\n');
}
