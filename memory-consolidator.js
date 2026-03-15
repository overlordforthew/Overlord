/**
 * Memory Consolidator — Daily memory maintenance cycle.
 * Inspired by human sleep memory processing:
 *   Decay → Boost → Merge → Prune → Auto-associate → Rebuild MEMORY.md
 *
 * Run via cron or manually: node memory-consolidator.js
 */

import pg from 'pg';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

// ── DB CONNECTION ─────────────────────────────────────────────────────────────

let _dbPass = process.env.CONV_DB_PASS || process.env.MEMORY_DB_PASS;
if (!_dbPass) {
  for (const p of ['/app/data/.overlord-db-pass', '/root/overlord/data/.overlord-db-pass']) {
    try { _dbPass = readFileSync(p, 'utf-8').trim(); break; } catch { /* next */ }
  }
}
if (!_dbPass) {
  for (const envPath of ['/root/overlord/.env', '/app/.env']) {
    try {
      const env = readFileSync(envPath, 'utf-8');
      const match = env.match(/CONV_DB_PASS=(.+)/);
      if (match) { _dbPass = match[1].trim(); break; }
    } catch { /* next */ }
  }
}

const pool = new pg.Pool({
  host: process.env.MEMORY_DB_HOST || (existsSync('/app') ? 'overlord-db' : '127.0.0.1'),
  port: parseInt(process.env.MEMORY_DB_PORT || '5432'),
  database: process.env.MEMORY_DB_NAME || 'overlord',
  user: process.env.MEMORY_DB_USER || 'overlord',
  password: _dbPass,
  max: 3,
  connectionTimeoutMillis: 5000,
});

// ── CONSOLIDATION STEPS ───────────────────────────────────────────────────────

async function decay() {
  const { rowCount } = await pool.query(`
    UPDATE semantic_memories
    SET importance = GREATEST(importance - 0.02, 0.1), updated_at = NOW()
    WHERE is_active = TRUE
      AND last_accessed < NOW() - INTERVAL '30 days'
      AND importance > 0.1
  `);
  return rowCount;
}

async function boost() {
  const { rowCount } = await pool.query(`
    UPDATE semantic_memories
    SET importance = LEAST(importance + 0.05, 1.0), updated_at = NOW()
    WHERE is_active = TRUE
      AND access_count > 5
      AND last_accessed > NOW() - INTERVAL '7 days'
      AND importance < 1.0
  `);
  return rowCount;
}

async function prune() {
  const { rowCount } = await pool.query(`
    UPDATE semantic_memories
    SET is_active = FALSE, updated_at = NOW()
    WHERE is_active = TRUE
      AND importance < 0.15
      AND access_count = 0
      AND created_at < NOW() - INTERVAL '30 days'
  `);
  return rowCount;
}

async function autoAssociate() {
  // Find semantic memories sharing 2+ tags that aren't already associated
  const { rows: tagGroups } = await pool.query(`
    SELECT a.id as a_id, b.id as b_id
    FROM semantic_memories a, semantic_memories b
    WHERE a.is_active = TRUE AND b.is_active = TRUE
      AND a.id < b.id
      AND (SELECT COUNT(*) FROM unnest(a.tags) t1 JOIN unnest(b.tags) t2 ON t1 = t2) >= 2
      AND NOT EXISTS (
        SELECT 1 FROM memory_associations
        WHERE source_type = 'semantic' AND source_id = a.id
          AND target_type = 'semantic' AND target_id = b.id
      )
    LIMIT 50
  `);

  let count = 0;
  for (const { a_id, b_id } of tagGroups) {
    await pool.query(
      `INSERT INTO memory_associations (source_type, source_id, target_type, target_id, relationship, strength)
       VALUES ('semantic', $1, 'semantic', $2, 'related_to', 0.3)
       ON CONFLICT DO NOTHING`,
      [a_id, b_id]
    );
    count++;
  }
  return count;
}

async function proceduralScoring() {
  // Deactivate consistently failing procedures
  const { rowCount } = await pool.query(`
    UPDATE procedural_memories
    SET is_active = FALSE, updated_at = NOW()
    WHERE is_active = TRUE
      AND failure_count > success_count * 3
      AND failure_count > 5
  `);
  return rowCount;
}

async function rebuildMemoryMd() {
  const lines = [];

  lines.push('# Overlord Memory Index');
  lines.push('');
  lines.push('> Auto-generated from semantic memory DB. Use `mem search <query>` or `mem recall <category>` for deeper knowledge.');
  lines.push('');

  // Tools
  const { rows: tools } = await pool.query(`
    SELECT topic, content FROM semantic_memories
    WHERE is_active = TRUE AND category = 'tool'
    ORDER BY importance DESC, access_count DESC LIMIT 15
  `);
  if (tools.length) {
    lines.push('## Tools');
    for (const t of tools) lines.push(`- **${t.topic}**: ${t.content.split('\n')[0].slice(0, 120)}`);
    lines.push('');
  }

  // Projects
  const { rows: projects } = await pool.query(`
    SELECT topic, content FROM semantic_memories
    WHERE is_active = TRUE AND category = 'project'
    ORDER BY importance DESC, access_count DESC LIMIT 10
  `);
  if (projects.length) {
    lines.push('## Projects');
    for (const p of projects) lines.push(`- **${p.topic}**: ${p.content.split('\n')[0].slice(0, 120)}`);
    lines.push('');
  }

  // Infrastructure
  const { rows: infra } = await pool.query(`
    SELECT topic, content FROM semantic_memories
    WHERE is_active = TRUE AND category = 'infrastructure'
    ORDER BY importance DESC, access_count DESC LIMIT 8
  `);
  if (infra.length) {
    lines.push('## Infrastructure');
    for (const i of infra) lines.push(`- **${i.topic}**: ${i.content.split('\n')[0].slice(0, 120)}`);
    lines.push('');
  }

  // Key procedures
  const { rows: procs } = await pool.query(`
    SELECT trigger_pattern, procedure FROM procedural_memories
    WHERE is_active = TRUE ORDER BY (success_count - failure_count) DESC LIMIT 5
  `);
  if (procs.length) {
    lines.push('## Key Procedures');
    for (const p of procs) lines.push(`- **${p.trigger_pattern}**: ${p.procedure.split('\n')[0].slice(0, 100)}`);
    lines.push('');
  }

  // Preferences
  const { rows: prefs } = await pool.query(`
    SELECT content FROM semantic_memories
    WHERE is_active = TRUE AND category = 'preference'
    ORDER BY importance DESC LIMIT 5
  `);
  if (prefs.length) {
    lines.push('## Preferences');
    for (const p of prefs) lines.push(`- ${p.content.split('\n')[0].slice(0, 120)}`);
    lines.push('');
  }

  const output = lines.slice(0, 190).join('\n');

  // Write to auto-memory location
  const memPath = '/root/.claude/projects/-root/memory/MEMORY.md';
  try {
    writeFileSync(memPath, output, 'utf-8');
    return { path: memPath, lines: lines.length };
  } catch {
    const altPath = '/app/data/MEMORY.md';
    try {
      writeFileSync(altPath, output, 'utf-8');
      return { path: altPath, lines: lines.length };
    } catch {
      return { path: null, lines: lines.length };
    }
  }
}

// ── MAIN CONSOLIDATION CYCLE ──────────────────────────────────────────────────

export async function consolidate() {
  const report = {};

  try {
    report.decayed = await decay();
    report.boosted = await boost();
    report.pruned = await prune();
    report.associated = await autoAssociate();
    report.proc_deactivated = await proceduralScoring();
    report.rebuild = await rebuildMemoryMd();

    // Stats after consolidation
    const { rows: [stats] } = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM semantic_memories WHERE is_active = TRUE) as semantic,
        (SELECT COUNT(*) FROM procedural_memories WHERE is_active = TRUE) as procedural,
        (SELECT COUNT(*) FROM memory_associations) as associations,
        (SELECT ROUND(AVG(importance)::numeric, 2) FROM semantic_memories WHERE is_active = TRUE) as avg_importance
    `);
    report.stats = stats;

    return report;
  } catch (err) {
    report.error = err.message;
    return report;
  }
}

// ── CLI ENTRY POINT ───────────────────────────────────────────────────────────

if (process.argv[1] && (process.argv[1].endsWith('memory-consolidator.js') || process.argv[1].endsWith('memory-consolidator.mjs'))) {
  try {
    const report = await consolidate();
    console.log('=== Memory Consolidation Report ===');
    console.log(`Decayed:      ${report.decayed} memories`);
    console.log(`Boosted:      ${report.boosted} memories`);
    console.log(`Pruned:       ${report.pruned} memories`);
    console.log(`Associated:   ${report.associated} new links`);
    console.log(`Procedures:   ${report.proc_deactivated} deactivated`);
    if (report.rebuild?.path) {
      console.log(`MEMORY.md:    ${report.rebuild.lines} lines → ${report.rebuild.path}`);
    }
    if (report.stats) {
      console.log(`\nPost-consolidation: ${report.stats.semantic} semantic, ${report.stats.procedural} procedural, ${report.stats.associations} associations (avg importance: ${report.stats.avg_importance})`);
    }
    if (report.error) {
      console.error(`Error: ${report.error}`);
    }
  } finally {
    await pool.end();
  }
}

export { pool as consolidatorPool };
