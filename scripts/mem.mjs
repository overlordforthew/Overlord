#!/usr/bin/env node
/**
 * mem — Overlord Memory CLI
 * Interact with the semantic/procedural/episodic memory database.
 *
 * Usage:
 *   mem search <query>                   Full-text search across all memory types
 *   mem recall <category> [topic]        Browse semantic memories by category
 *   mem get <type> <id>                  Get specific memory with associations
 *   mem save <category>/<topic> "content" Save semantic memory
 *       [--importance N] [--tags t1,t2] [--project P] [--confidence N]
 *   mem update <id> "new content"        Update semantic memory content
 *   mem link <type1>:<id1> <type2>:<id2> <relationship>  Create association
 *   mem forget <id>                      Soft-delete semantic memory
 *   mem strengthen <id>                  Boost importance by 0.1
 *   mem weaken <id>                      Reduce importance by 0.1
 *   mem learn "trigger" "procedure"      Save procedural memory
 *       [--category C] [--project P]
 *   mem procedures [query]               List/search procedural memories
 *   mem stats                            Memory health dashboard
 *   mem rebuild                          Regenerate MEMORY.md from DB
 *   mem consolidate                      Run full consolidation cycle
 *   mem context <query>                  Get formatted context block
 *   mem associate <query>                Follow association chains
 */

import pg from 'pg';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

// ── DB CONNECTION ─────────────────────────────────────────────────────────────

let _dbPass = process.env.CONV_DB_PASS || process.env.MEMORY_DB_PASS;
if (!_dbPass) {
  // Try reading from multiple locations
  for (const p of ['/app/data/.overlord-db-pass', '/root/overlord/data/.overlord-db-pass']) {
    try { _dbPass = readFileSync(p, 'utf-8').trim(); break; } catch { /* next */ }
  }
}
if (!_dbPass) {
  // Try reading from .env file
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

// ── HELPERS ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const cmd = args[0];
const jsonMode = args.includes('--json');

function getFlag(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function print(data) {
  if (jsonMode) {
    console.log(JSON.stringify(data, null, 2));
  } else if (Array.isArray(data)) {
    if (!data.length) { console.log('(no results)'); return; }
    for (const row of data) {
      printRow(row);
    }
  } else if (typeof data === 'object') {
    printRow(data);
  } else {
    console.log(data);
  }
}

function printRow(row) {
  if (row.trigger_pattern) {
    // Procedural
    const score = (row.success_count || 0) - (row.failure_count || 0);
    console.log(`[P:${row.id}] ${row.trigger_pattern} (${row.category || 'ops'}, score:${score})`);
    console.log(`  ${row.procedure.split('\n')[0].slice(0, 120)}`);
  } else if (row.category && row.topic) {
    // Semantic
    const imp = typeof row.importance === 'number' ? row.importance.toFixed(1) : '?';
    const tags = (row.tags || []).join(',');
    console.log(`[S:${row.id}] ${row.category}/${row.topic} (imp:${imp}${tags ? ' tags:' + tags : ''}${row.project ? ' proj:' + row.project : ''})`);
    console.log(`  ${row.content.split('\n')[0].slice(0, 150)}`);
  } else if (row.source_type) {
    // Association
    console.log(`  ${row.source_type}:${row.source_id} --[${row.relationship}]--> ${row.target_type}:${row.target_id} (str:${row.strength})`);
  } else {
    // Generic
    const keys = Object.keys(row);
    console.log(keys.map(k => `${k}: ${row[k]}`).join(' | '));
  }
}

function usage() {
  console.log(`mem — Overlord Memory CLI

USAGE:
  mem search <query>                    Full-text search across all memory types
  mem recall <category> [topic]         Browse semantic memories by category
  mem get <type> <id>                   Get specific memory with associations
  mem save <category>/<topic> "content" Save semantic memory
      [--importance N] [--tags t1,t2] [--project P] [--confidence N]
  mem update <id> "new content"         Update semantic memory content
  mem link <type1>:<id1> <type2>:<id2> <relationship>  Create association
  mem forget <id>                       Soft-delete semantic memory
  mem strengthen <id>                   Boost importance by 0.1 (cap 1.0)
  mem weaken <id>                       Reduce importance by 0.1 (floor 0.1)
  mem learn "trigger" "procedure"       Save procedural memory
      [--category C] [--project P]
  mem procedures [query]                List/search procedural memories
  mem stats                             Memory health dashboard
  mem rebuild                           Regenerate MEMORY.md from DB
  mem consolidate                       Run full consolidation cycle
  mem context <query>                   Get formatted context block
  mem associate <query>                 Follow association chains

FLAGS:
  --json          Output as JSON
  --importance N  Set importance (0.0-1.0)
  --confidence N  Set confidence (0.0-1.0)
  --tags t1,t2    Comma-separated tags
  --project P     Link to project
  --category C    Procedural category (ops/deploy/debug/security/develop)
`);
}

// ── COMMANDS ──────────────────────────────────────────────────────────────────

async function cmdSearch() {
  const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
  if (!query) { console.error('Usage: mem search <query>'); process.exit(1); }

  // Search semantic
  const { rows: semantic } = await pool.query(`
    SELECT id, category, topic, content, summary, importance, tags, project,
           ts_rank(search_vector, plainto_tsquery('english', $1)) AS rank
    FROM semantic_memories
    WHERE is_active = TRUE
      AND (search_vector @@ plainto_tsquery('english', $1) OR topic ILIKE '%' || $1 || '%' OR content ILIKE '%' || $1 || '%')
    ORDER BY rank DESC, importance DESC LIMIT 10
  `, [query]);

  // Search procedural
  const { rows: procedural } = await pool.query(`
    SELECT id, trigger_pattern, procedure, category, success_count, failure_count
    FROM procedural_memories
    WHERE is_active = TRUE
      AND (search_vector @@ plainto_tsquery('english', $1) OR trigger_pattern ILIKE '%' || $1 || '%')
    ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC LIMIT 5
  `, [query]);

  // Search episodic
  const { rows: episodic } = await pool.query(`
    SELECT id, jid, content, summary, importance, tags
    FROM episodic_memories
    WHERE is_active = TRUE
      AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
    ORDER BY ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) DESC LIMIT 5
  `, [query]);

  if (jsonMode) {
    print({ semantic, procedural, episodic });
    return;
  }

  if (semantic.length) {
    console.log(`\n=== Semantic (${semantic.length}) ===`);
    print(semantic);
  }
  if (procedural.length) {
    console.log(`\n=== Procedural (${procedural.length}) ===`);
    print(procedural);
  }
  if (episodic.length) {
    console.log(`\n=== Episodic (${episodic.length}) ===`);
    for (const e of episodic) {
      console.log(`[E:${e.id}] (${e.jid?.split('@')[0]}) ${e.content.slice(0, 120)}`);
    }
  }

  if (!semantic.length && !procedural.length && !episodic.length) {
    console.log('No results found.');
  }

  // Update access counts for semantic results
  if (semantic.length) {
    await pool.query(
      `UPDATE semantic_memories SET last_accessed = NOW(), access_count = access_count + 1 WHERE id = ANY($1)`,
      [semantic.map(r => r.id)]
    );
  }
}

async function cmdRecall() {
  const category = args[1];
  const topic = args[2] && !args[2].startsWith('--') ? args[2] : null;
  if (!category) { console.error('Usage: mem recall <category> [topic]'); process.exit(1); }

  let sql = `SELECT id, category, topic, content, summary, importance, tags, project, access_count
             FROM semantic_memories WHERE is_active = TRUE AND category = $1`;
  const params = [category];

  if (topic) {
    sql += ` AND topic = $2`;
    params.push(topic);
  }

  sql += ` ORDER BY importance DESC, access_count DESC LIMIT 20`;
  const { rows } = await pool.query(sql, params);
  print(rows);
}

async function cmdGet() {
  const type = args[1];
  const id = parseInt(args[2]);
  if (!type || !id) { console.error('Usage: mem get <semantic|episodic|procedural> <id>'); process.exit(1); }

  let table;
  if (type === 'semantic' || type === 's') table = 'semantic_memories';
  else if (type === 'episodic' || type === 'e') table = 'episodic_memories';
  else if (type === 'procedural' || type === 'p') table = 'procedural_memories';
  else { console.error('Type must be: semantic, episodic, or procedural'); process.exit(1); }

  const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  if (!rows.length) { console.log('Not found.'); process.exit(1); }

  if (jsonMode) {
    // Also get associations
    const { rows: assocs } = await pool.query(
      `SELECT * FROM memory_associations WHERE (source_type = $1 AND source_id = $2) OR (target_type = $1 AND target_id = $2)`,
      [type.charAt(0) === 's' ? 'semantic' : type.charAt(0) === 'e' ? 'episodic' : 'procedural', id]
    );
    print({ ...rows[0], associations: assocs });
    return;
  }

  const r = rows[0];
  console.log(`--- ${type} #${id} ---`);
  for (const [k, v] of Object.entries(r)) {
    if (k === 'search_vector') continue;
    console.log(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
  }

  // Show associations
  const typeKey = type.startsWith('s') ? 'semantic' : type.startsWith('e') ? 'episodic' : 'procedural';
  const { rows: assocs } = await pool.query(
    `SELECT * FROM memory_associations WHERE (source_type = $1 AND source_id = $2) OR (target_type = $1 AND target_id = $2)`,
    [typeKey, id]
  );
  if (assocs.length) {
    console.log('\nAssociations:');
    print(assocs);
  }
}

async function cmdSave() {
  const catTopic = args[1];
  const content = args[2];
  if (!catTopic || !content || !catTopic.includes('/')) {
    console.error('Usage: mem save <category>/<topic> "content" [--importance N] [--tags t1,t2]');
    process.exit(1);
  }

  const [category, ...topicParts] = catTopic.split('/');
  const topic = topicParts.join('/');
  const importance = parseFloat(getFlag('importance') || '0.5');
  const confidence = parseFloat(getFlag('confidence') || '1.0');
  const tags = getFlag('tags') ? getFlag('tags').split(',') : [];
  const project = getFlag('project');

  // Check for existing entry with same category+topic
  const { rows: existing } = await pool.query(
    `SELECT id FROM semantic_memories WHERE category = $1 AND topic = $2 AND is_active = TRUE`,
    [category, topic]
  );

  let id;
  if (existing.length) {
    // Update
    await pool.query(
      `UPDATE semantic_memories SET content = $1, summary = $2, importance = GREATEST(importance, $3),
       confidence = $4, tags = $5, project = $6, updated_at = NOW() WHERE id = $7`,
      [content.trim(), content.trim().slice(0, 60), importance, confidence, tags, project, existing[0].id]
    );
    id = existing[0].id;
    console.log(`Updated S:${id} (${category}/${topic})`);
  } else {
    const { rows } = await pool.query(
      `INSERT INTO semantic_memories (category, topic, content, summary, importance, confidence, tags, project)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [category, topic, content.trim(), content.trim().slice(0, 60), importance, confidence, tags, project]
    );
    id = rows[0].id;
    console.log(`Saved S:${id} (${category}/${topic})`);
  }
}

async function cmdUpdate() {
  const id = parseInt(args[1]);
  const content = args[2];
  if (!id || !content) { console.error('Usage: mem update <id> "new content"'); process.exit(1); }

  await pool.query(
    `UPDATE semantic_memories SET content = $1, summary = $2, updated_at = NOW() WHERE id = $3 AND is_active = TRUE`,
    [content.trim(), content.trim().slice(0, 60), id]
  );
  console.log(`Updated S:${id}`);
}

async function cmdLink() {
  // mem link semantic:1 procedural:2 related_to
  const src = args[1];
  const tgt = args[2];
  const rel = args[3];
  if (!src || !tgt || !rel) {
    console.error('Usage: mem link <type>:<id> <type>:<id> <relationship>');
    process.exit(1);
  }

  const [st, si] = src.split(':');
  const [tt, ti] = tgt.split(':');
  const strength = parseFloat(getFlag('strength') || '0.5');

  const { rows } = await pool.query(
    `INSERT INTO memory_associations (source_type, source_id, target_type, target_id, relationship, strength)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (source_type, source_id, target_type, target_id, relationship)
     DO UPDATE SET strength = EXCLUDED.strength
     RETURNING id`,
    [st, parseInt(si), tt, parseInt(ti), rel, strength]
  );
  console.log(`Linked ${src} --[${rel}]--> ${tgt} (id:${rows[0].id})`);
}

async function cmdForget() {
  const id = parseInt(args[1]);
  if (!id) { console.error('Usage: mem forget <id>'); process.exit(1); }
  await pool.query(`UPDATE semantic_memories SET is_active = FALSE, updated_at = NOW() WHERE id = $1`, [id]);
  console.log(`Forgot S:${id}`);
}

async function cmdStrengthen() {
  const id = parseInt(args[1]);
  if (!id) { console.error('Usage: mem strengthen <id>'); process.exit(1); }
  await pool.query(`UPDATE semantic_memories SET importance = LEAST(importance + 0.1, 1.0), updated_at = NOW() WHERE id = $1`, [id]);
  const { rows } = await pool.query(`SELECT importance FROM semantic_memories WHERE id = $1`, [id]);
  console.log(`Strengthened S:${id} → importance: ${rows[0]?.importance?.toFixed(1)}`);
}

async function cmdWeaken() {
  const id = parseInt(args[1]);
  if (!id) { console.error('Usage: mem weaken <id>'); process.exit(1); }
  await pool.query(`UPDATE semantic_memories SET importance = GREATEST(importance - 0.1, 0.1), updated_at = NOW() WHERE id = $1`, [id]);
  const { rows } = await pool.query(`SELECT importance FROM semantic_memories WHERE id = $1`, [id]);
  console.log(`Weakened S:${id} → importance: ${rows[0]?.importance?.toFixed(1)}`);
}

async function cmdLearn() {
  const trigger = args[1];
  const procedure = args[2];
  if (!trigger || !procedure) {
    console.error('Usage: mem learn "trigger pattern" "step-by-step procedure" [--category C] [--project P]');
    process.exit(1);
  }

  const category = getFlag('category') || 'ops';
  const project = getFlag('project');

  const { rows } = await pool.query(
    `INSERT INTO procedural_memories (trigger_pattern, procedure, category, project)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [trigger, procedure, category, project]
  );
  console.log(`Learned P:${rows[0].id} (${category}): ${trigger}`);
}

async function cmdProcedures() {
  const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');

  if (query) {
    const { rows } = await pool.query(`
      SELECT id, trigger_pattern, procedure, category, project, success_count, failure_count, last_used
      FROM procedural_memories
      WHERE is_active = TRUE
        AND (search_vector @@ plainto_tsquery('english', $1) OR trigger_pattern ILIKE '%' || $1 || '%')
      ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC LIMIT 10
    `, [query]);
    print(rows);
  } else {
    const { rows } = await pool.query(`
      SELECT id, trigger_pattern, procedure, category, project, success_count, failure_count, last_used
      FROM procedural_memories WHERE is_active = TRUE
      ORDER BY (success_count - failure_count) DESC, created_at DESC LIMIT 20
    `);
    print(rows);
  }
}

async function cmdStats() {
  const { rows: [s] } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM semantic_memories WHERE is_active = TRUE) as semantic_active,
      (SELECT COUNT(*) FROM semantic_memories WHERE is_active = FALSE) as semantic_inactive,
      (SELECT COUNT(*) FROM procedural_memories WHERE is_active = TRUE) as procedural_active,
      (SELECT COUNT(*) FROM episodic_memories WHERE is_active = TRUE) as episodic_active,
      (SELECT COUNT(*) FROM memory_associations) as associations,
      (SELECT COUNT(DISTINCT category) FROM semantic_memories WHERE is_active = TRUE) as categories,
      (SELECT COUNT(DISTINCT topic) FROM semantic_memories WHERE is_active = TRUE) as topics,
      (SELECT ROUND(AVG(importance)::numeric, 2) FROM semantic_memories WHERE is_active = TRUE) as avg_importance,
      (SELECT MAX(updated_at) FROM semantic_memories) as last_semantic_update,
      (SELECT MAX(created_at) FROM episodic_memories) as last_episodic
  `);

  if (jsonMode) { print(s); return; }

  console.log(`=== Overlord Memory Stats ===
Semantic:    ${s.semantic_active} active, ${s.semantic_inactive} archived
Procedural:  ${s.procedural_active} active
Episodic:    ${s.episodic_active} active
Associations: ${s.associations}
Categories:  ${s.categories} (${s.topics} unique topics)
Avg Importance: ${s.avg_importance}
Last semantic: ${s.last_semantic_update || 'never'}
Last episodic: ${s.last_episodic || 'never'}`);

  // Category breakdown
  const { rows: cats } = await pool.query(`
    SELECT category, COUNT(*) as count, ROUND(AVG(importance)::numeric, 2) as avg_imp
    FROM semantic_memories WHERE is_active = TRUE
    GROUP BY category ORDER BY count DESC
  `);
  if (cats.length) {
    console.log('\nCategories:');
    for (const c of cats) {
      console.log(`  ${c.category}: ${c.count} (avg imp: ${c.avg_imp})`);
    }
  }
}

async function cmdRebuild() {
  console.log('Rebuilding MEMORY.md from database...');
  const lines = [];

  // Header
  lines.push('# Overlord Memory Index');
  lines.push('');
  lines.push('> Auto-generated from semantic memory DB. For deeper knowledge: `mem search <query>` or `mem recall <category>`');
  lines.push('');

  // Tools
  const { rows: tools } = await pool.query(`
    SELECT topic, content FROM semantic_memories
    WHERE is_active = TRUE AND category = 'tool'
    ORDER BY importance DESC, access_count DESC LIMIT 15
  `);
  if (tools.length) {
    lines.push('## Tools');
    for (const t of tools) {
      lines.push(`- **${t.topic}**: ${t.content.split('\n')[0].slice(0, 120)}`);
    }
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
    for (const p of projects) {
      lines.push(`- **${p.topic}**: ${p.content.split('\n')[0].slice(0, 120)}`);
    }
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
    for (const i of infra) {
      lines.push(`- **${i.topic}**: ${i.content.split('\n')[0].slice(0, 120)}`);
    }
    lines.push('');
  }

  // Security
  const { rows: sec } = await pool.query(`
    SELECT topic, content FROM semantic_memories
    WHERE is_active = TRUE AND category = 'security'
    ORDER BY importance DESC, access_count DESC LIMIT 5
  `);
  if (sec.length) {
    lines.push('## Security');
    for (const s of sec) {
      lines.push(`- **${s.topic}**: ${s.content.split('\n')[0].slice(0, 120)}`);
    }
    lines.push('');
  }

  // Integrations
  const { rows: integrations } = await pool.query(`
    SELECT topic, content FROM semantic_memories
    WHERE is_active = TRUE AND category = 'integration'
    ORDER BY importance DESC, access_count DESC LIMIT 8
  `);
  if (integrations.length) {
    lines.push('## Integrations');
    for (const ig of integrations) {
      lines.push(`- **${ig.topic}**: ${ig.content.split('\n')[0].slice(0, 120)}`);
    }
    lines.push('');
  }

  // Top procedures
  const { rows: procs } = await pool.query(`
    SELECT trigger_pattern, procedure FROM procedural_memories
    WHERE is_active = TRUE
    ORDER BY (success_count - failure_count) DESC LIMIT 5
  `);
  if (procs.length) {
    lines.push('## Key Procedures');
    for (const p of procs) {
      lines.push(`- **${p.trigger_pattern}**: ${p.procedure.split('\n')[0].slice(0, 100)}`);
    }
    lines.push('');
  }

  // Preferences
  const { rows: prefs } = await pool.query(`
    SELECT topic, content FROM semantic_memories
    WHERE is_active = TRUE AND category = 'preference'
    ORDER BY importance DESC LIMIT 5
  `);
  if (prefs.length) {
    lines.push('## Preferences');
    for (const p of prefs) {
      lines.push(`- ${p.content.split('\n')[0].slice(0, 120)}`);
    }
    lines.push('');
  }

  // Cap at 190 lines
  const output = lines.slice(0, 190).join('\n');

  // Write to the auto-memory location
  const memPath = '/root/.claude/projects/-root/memory/MEMORY.md';
  try {
    writeFileSync(memPath, output, 'utf-8');
    console.log(`Wrote ${lines.length} lines to ${memPath}`);
  } catch {
    // Might be inside container — try alternate path
    const altPath = '/app/data/MEMORY.md';
    writeFileSync(altPath, output, 'utf-8');
    console.log(`Wrote ${lines.length} lines to ${altPath} (container mode)`);
  }
}

async function cmdConsolidate() {
  console.log('Running memory consolidation...');
  const now = new Date();
  let changes = { decayed: 0, boosted: 0, pruned: 0, associated: 0 };

  // 1. Decay — reduce importance of memories not accessed in 30+ days
  const { rowCount: decayed } = await pool.query(`
    UPDATE semantic_memories
    SET importance = GREATEST(importance - 0.02, 0.1), updated_at = NOW()
    WHERE is_active = TRUE
      AND last_accessed < NOW() - INTERVAL '30 days'
      AND importance > 0.1
  `);
  changes.decayed = decayed;

  // 2. Boost — increase importance of frequently accessed recent memories
  const { rowCount: boosted } = await pool.query(`
    UPDATE semantic_memories
    SET importance = LEAST(importance + 0.05, 1.0), updated_at = NOW()
    WHERE is_active = TRUE
      AND access_count > 5
      AND last_accessed > NOW() - INTERVAL '7 days'
      AND importance < 1.0
  `);
  changes.boosted = boosted;

  // 3. Prune — deactivate low-value, never-accessed memories
  const { rowCount: pruned } = await pool.query(`
    UPDATE semantic_memories
    SET is_active = FALSE, updated_at = NOW()
    WHERE is_active = TRUE
      AND importance < 0.15
      AND access_count = 0
      AND created_at < NOW() - INTERVAL '30 days'
  `);
  changes.pruned = pruned;

  // 4. Auto-associate — find memories sharing tags
  const { rows: tagGroups } = await pool.query(`
    SELECT a.id as a_id, b.id as b_id
    FROM semantic_memories a, semantic_memories b
    WHERE a.is_active = TRUE AND b.is_active = TRUE
      AND a.id < b.id
      AND array_length(a.tags & b.tags, 1) >= 2
      AND NOT EXISTS (
        SELECT 1 FROM memory_associations
        WHERE source_type = 'semantic' AND source_id = a.id
          AND target_type = 'semantic' AND target_id = b.id
      )
    LIMIT 50
  `);
  for (const { a_id, b_id } of tagGroups) {
    await pool.query(
      `INSERT INTO memory_associations (source_type, source_id, target_type, target_id, relationship, strength)
       VALUES ('semantic', $1, 'semantic', $2, 'related_to', 0.3)
       ON CONFLICT DO NOTHING`,
      [a_id, b_id]
    );
    changes.associated++;
  }

  // 5. Procedural scoring — boost successful procedures
  await pool.query(`
    UPDATE procedural_memories
    SET is_active = FALSE, updated_at = NOW()
    WHERE is_active = TRUE
      AND failure_count > success_count * 3
      AND failure_count > 5
  `);

  console.log(`Consolidation complete:
  Decayed: ${changes.decayed} memories
  Boosted: ${changes.boosted} memories
  Pruned:  ${changes.pruned} memories
  Associated: ${changes.associated} new links`);

  // 6. Rebuild MEMORY.md
  await cmdRebuild();
}

async function cmdContext() {
  const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
  if (!query) { console.error('Usage: mem context <query>'); process.exit(1); }

  // Semantic search
  const { rows: semantic } = await pool.query(`
    SELECT category, topic, content, importance
    FROM semantic_memories
    WHERE is_active = TRUE
      AND (search_vector @@ plainto_tsquery('english', $1) OR topic ILIKE '%' || $1 || '%' OR content ILIKE '%' || $1 || '%')
    ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC, importance DESC
    LIMIT 10
  `, [query]);

  // Procedural search
  const { rows: procedural } = await pool.query(`
    SELECT trigger_pattern, procedure
    FROM procedural_memories
    WHERE is_active = TRUE
      AND (search_vector @@ plainto_tsquery('english', $1) OR trigger_pattern ILIKE '%' || $1 || '%')
    ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
    LIMIT 3
  `, [query]);

  if (!semantic.length && !procedural.length) {
    console.log(`(no system knowledge found for: ${query})`);
    return;
  }

  // Format as markdown context block
  const lines = ['[SYSTEM KNOWLEDGE]'];
  if (semantic.length) {
    for (const r of semantic) {
      const bold = r.importance >= 0.8;
      lines.push(`- ${bold ? '**' : ''}[${r.category}/${r.topic}]${bold ? '**' : ''} ${r.content.split('\n')[0]}`);
    }
  }
  if (procedural.length) {
    lines.push('');
    lines.push('Relevant procedures:');
    for (const p of procedural) {
      lines.push(`- When "${p.trigger_pattern}": ${p.procedure.split('\n')[0]}`);
    }
  }
  console.log(lines.join('\n'));

  // Update access counts
  if (semantic.length) {
    await pool.query(
      `UPDATE semantic_memories SET last_accessed = NOW(), access_count = access_count + 1
       WHERE id = ANY(SELECT id FROM semantic_memories WHERE is_active = TRUE
         AND (search_vector @@ plainto_tsquery('english', $1) OR topic ILIKE '%' || $1 || '%')
         LIMIT 10)`,
      [query]
    );
  }
}

async function cmdAssociate() {
  const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
  if (!query) { console.error('Usage: mem associate <query>'); process.exit(1); }

  // Find semantic matches first
  const { rows: roots } = await pool.query(`
    SELECT id, category, topic, content, importance
    FROM semantic_memories
    WHERE is_active = TRUE
      AND (search_vector @@ plainto_tsquery('english', $1) OR topic ILIKE '%' || $1 || '%')
    ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC LIMIT 5
  `, [query]);

  if (!roots.length) { console.log('No results found.'); return; }

  for (const root of roots) {
    console.log(`\n[S:${root.id}] ${root.category}/${root.topic} (imp:${root.importance?.toFixed(1)})`);
    console.log(`  ${root.content.split('\n')[0].slice(0, 120)}`);

    // Follow associations
    const { rows: assocs } = await pool.query(
      `SELECT * FROM memory_associations
       WHERE (source_type = 'semantic' AND source_id = $1) OR (target_type = 'semantic' AND target_id = $1)
       ORDER BY strength DESC LIMIT 10`,
      [root.id]
    );

    for (const a of assocs) {
      const otherId = a.source_id === root.id && a.source_type === 'semantic' ? a.target_id : a.source_id;
      const otherType = a.source_id === root.id && a.source_type === 'semantic' ? a.target_type : a.source_type;

      let table = 'semantic_memories';
      if (otherType === 'episodic') table = 'episodic_memories';
      else if (otherType === 'procedural') table = 'procedural_memories';

      const { rows: [other] } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [otherId]);
      if (other) {
        const label = otherType === 'semantic' ? `${other.category}/${other.topic}` :
                     otherType === 'procedural' ? other.trigger_pattern :
                     other.summary || other.content?.slice(0, 60);
        console.log(`  --[${a.relationship}]--> [${otherType.charAt(0).toUpperCase()}:${otherId}] ${label}`);
      }
    }
  }
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

async function main() {
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    usage();
    process.exit(0);
  }

  try {
    // Ensure tables exist
    try {
      await pool.query('SELECT 1 FROM semantic_memories LIMIT 0');
    } catch {
      console.error('Semantic tables not found. Run the app first to create schema.');
      process.exit(1);
    }

    switch (cmd) {
      case 'search': await cmdSearch(); break;
      case 'recall': await cmdRecall(); break;
      case 'get': await cmdGet(); break;
      case 'save': await cmdSave(); break;
      case 'update': await cmdUpdate(); break;
      case 'link': await cmdLink(); break;
      case 'forget': await cmdForget(); break;
      case 'strengthen': await cmdStrengthen(); break;
      case 'weaken': await cmdWeaken(); break;
      case 'learn': await cmdLearn(); break;
      case 'procedures': await cmdProcedures(); break;
      case 'stats': await cmdStats(); break;
      case 'rebuild': await cmdRebuild(); break;
      case 'consolidate': await cmdConsolidate(); break;
      case 'context': await cmdContext(); break;
      case 'associate': await cmdAssociate(); break;
      default:
        console.error(`Unknown command: ${cmd}`);
        usage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
