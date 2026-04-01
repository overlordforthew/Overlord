#!/usr/bin/env node
/**
 * mem — Overlord Memory CLI (v2 — SQLite-backed)
 * Interact with the semantic/procedural/episodic memory database.
 *
 * Usage:
 *   mem search <query>                   Full-text search across all memory types
 *   mem recall <category> [topic]        Browse semantic memories by category
 *   mem get <type> <id>                  Get specific memory
 *   mem save <category>/<topic> "content" Save semantic memory
 *       [--importance N] [--tags t1,t2] [--project P] [--confidence N]
 *   mem update <id> "new content"        Update semantic memory content
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
 */

import { initSchema } from '../skills/memory-v2/lib/schema.mjs';
import { getDb, closeDb } from '../skills/memory-v2/lib/db.mjs';
import * as observations from '../skills/memory-v2/lib/observations.mjs';
import { writeFileSync, readFileSync } from 'fs';

const args = process.argv.slice(2);
const cmd = args[0];
const jsonMode = args.includes('--json');

function getFlag(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

function parseTags(val) {
  if (!val) return [];
  return val.split(',').map(t => t.trim()).filter(Boolean);
}

function printRow(row) {
  if (row.type === 'procedural' || row.trigger_pattern) {
    const meta = row.metadata ? JSON.parse(row.metadata) : {};
    const score = (meta.success_count || 0) - (meta.failure_count || 0);
    console.log(`[P:${row.id}] ${row.title} (${row.category || 'ops'}, score:${score})`);
    console.log(`  ${(row.narrative || '').split('\n')[0].slice(0, 120)}`);
  } else if (row.type === 'semantic' || row.category) {
    const imp = typeof row.importance === 'number' ? row.importance.toFixed(1) : '?';
    const tags = row.tags ? JSON.parse(row.tags).join(',') : '';
    console.log(`[S:${row.id}] ${row.category}/${row.title} (imp:${imp}${tags ? ' tags:' + tags : ''}${row.project ? ' proj:' + row.project : ''})`);
    console.log(`  ${(row.narrative || row.title).split('\n')[0].slice(0, 150)}`);
  } else if (row.type === 'episodic') {
    const imp = Math.round((row.importance || 0.5) * 10);
    console.log(`[E:${row.id}] (${row.jid?.split('@')[0] || '?'}) imp:${imp} ${(row.narrative || row.title).slice(0, 120)}`);
  } else {
    console.log(`[${row.id}] ${row.type}/${row.title} — ${(row.narrative || '').slice(0, 100)}`);
  }
}

function usage() {
  console.log(`mem — Overlord Memory CLI (v2, SQLite-backed)

USAGE:
  mem search <query>                    Full-text search across all memory types
  mem recall <category> [topic]         Browse semantic memories by category
  mem get <type> <id>                   Get specific memory
  mem save <category>/<topic> "content" Save semantic memory
      [--importance N] [--tags t1,t2] [--project P] [--confidence N]
  mem update <id> "new content"         Update semantic memory content
  mem forget <id>                       Soft-delete (archive)
  mem strengthen <id>                   Boost importance by 0.1 (cap 1.0)
  mem weaken <id>                       Reduce importance by 0.1 (floor 0.1)
  mem learn "trigger" "procedure"       Save procedural memory
      [--category C] [--project P]
  mem procedures [query]                List/search procedural memories
  mem stats                             Memory health dashboard
  mem rebuild                           Regenerate MEMORY.md from DB
  mem consolidate                       Run decay/boost/prune cycle
  mem context <query>                   Get formatted context block

FLAGS:
  --json          Output as JSON
  --importance N  Set importance (0.0-1.0)
  --confidence N  Set confidence (0.0-1.0)
  --tags t1,t2    Comma-separated tags
  --project P     Link to project
  --category C    Procedural category
`);
}

try {
  initSchema();
  const db = getDb();

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    usage();
    process.exit(0);
  }

  switch (cmd) {
    case 'search': {
      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      if (!query) { console.error('Usage: mem search <query>'); process.exit(1); }

      const results = observations.search(query);

      if (jsonMode) { console.log(JSON.stringify(results, null, 2)); break; }

      const semantic = results.filter(r => r.type === 'semantic');
      const procedural = results.filter(r => r.type === 'procedural');
      const episodic = results.filter(r => r.type === 'episodic');
      const other = results.filter(r => !['semantic', 'procedural', 'episodic'].includes(r.type));

      if (semantic.length) { console.log(`\n=== Semantic (${semantic.length}) ===`); semantic.forEach(printRow); }
      if (procedural.length) { console.log(`\n=== Procedural (${procedural.length}) ===`); procedural.forEach(printRow); }
      if (episodic.length) { console.log(`\n=== Episodic (${episodic.length}) ===`); episodic.forEach(printRow); }
      if (other.length) { console.log(`\n=== Other (${other.length}) ===`); other.forEach(printRow); }
      if (!results.length) console.log('No results found.');
      break;
    }

    case 'recall': {
      const category = args[1];
      const topic = args[2] && !args[2].startsWith('--') ? args[2] : null;
      if (!category) { console.error('Usage: mem recall <category> [topic]'); process.exit(1); }

      let sql = "SELECT * FROM observations WHERE status = 'active' AND type = 'semantic' AND category = ?";
      const params = [category];
      if (topic) { sql += ' AND title = ?'; params.push(topic); }
      sql += ' ORDER BY importance DESC, access_count DESC LIMIT 20';

      const rows = db.prepare(sql).all(...params);
      if (jsonMode) { console.log(JSON.stringify(rows, null, 2)); break; }
      if (!rows.length) { console.log('(no results)'); break; }
      rows.forEach(printRow);
      break;
    }

    case 'get': {
      const type = args[1];
      const id = parseInt(args[2]);
      if (!type || !id) { console.error('Usage: mem get <semantic|episodic|procedural> <id>'); process.exit(1); }

      const row = observations.getById(id);
      if (!row) { console.log('Not found.'); process.exit(1); }

      if (jsonMode) { console.log(JSON.stringify(row, null, 2)); break; }

      console.log(`--- ${row.type} #${row.id} ---`);
      for (const [k, v] of Object.entries(row)) {
        if (v === null || v === undefined) continue;
        console.log(`${k}: ${v}`);
      }
      break;
    }

    case 'save': {
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
      const tags = parseTags(getFlag('tags'));
      const project = getFlag('project');

      // Check existing
      const existing = db.prepare(
        "SELECT id FROM observations WHERE category = ? AND title = ? AND status = 'active' AND type = 'semantic' LIMIT 1"
      ).get(category, topic);

      if (existing) {
        observations.update(existing.id, { narrative: content.trim(), subtitle: content.trim().slice(0, 60), importance, confidence, tags, project });
        console.log(`Updated S:${existing.id} (${category}/${topic})`);
      } else {
        const id = observations.store({ type: 'semantic', category, title: topic, subtitle: content.trim().slice(0, 60), narrative: content.trim(), importance, confidence, tags, project, source: 'manual' });
        console.log(`Saved S:${id} (${category}/${topic})`);
      }
      break;
    }

    case 'update': {
      const id = parseInt(args[1]);
      const content = args[2];
      if (!id || !content) { console.error('Usage: mem update <id> "new content"'); process.exit(1); }
      observations.update(id, { narrative: content.trim(), subtitle: content.trim().slice(0, 60) });
      console.log(`Updated S:${id}`);
      break;
    }

    case 'forget': {
      const id = parseInt(args[1]);
      if (!id) { console.error('Usage: mem forget <id>'); process.exit(1); }
      observations.archive(id, { reason: 'forgotten via mem forget' });
      console.log(`Forgot S:${id}`);
      break;
    }

    case 'strengthen': {
      const id = parseInt(args[1]);
      if (!id) { console.error('Usage: mem strengthen <id>'); process.exit(1); }
      const obs = observations.getById(id);
      if (!obs) { console.log('Not found.'); process.exit(1); }
      const newImp = Math.min((obs.importance || 0.5) + 0.1, 1.0);
      observations.update(id, { importance: newImp });
      console.log(`Strengthened S:${id} -> importance: ${newImp.toFixed(1)}`);
      break;
    }

    case 'weaken': {
      const id = parseInt(args[1]);
      if (!id) { console.error('Usage: mem weaken <id>'); process.exit(1); }
      const obs = observations.getById(id);
      if (!obs) { console.log('Not found.'); process.exit(1); }
      const newImp = Math.max((obs.importance || 0.5) - 0.1, 0.1);
      observations.update(id, { importance: newImp });
      console.log(`Weakened S:${id} -> importance: ${newImp.toFixed(1)}`);
      break;
    }

    case 'learn': {
      const trigger = args[1];
      const procedure = args[2];
      if (!trigger || !procedure) { console.error('Usage: mem learn "trigger" "procedure" [--category C] [--project P]'); process.exit(1); }
      const category = getFlag('category') || 'ops';
      const project = getFlag('project');
      const id = observations.store({ type: 'procedural', title: trigger, narrative: procedure, category, project, metadata: { success_count: 0, failure_count: 0 }, source: 'manual' });
      console.log(`Learned P:${id} (${category}): ${trigger}`);
      break;
    }

    case 'procedures': {
      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      let rows;
      if (query) {
        try {
          rows = db.prepare(`
            SELECT o.* FROM observations_fts fts JOIN observations o ON o.id = fts.rowid
            WHERE observations_fts MATCH ? AND o.status = 'active' AND o.type = 'procedural'
            ORDER BY fts.rank LIMIT 10
          `).all(query);
        } catch {
          rows = db.prepare("SELECT * FROM observations WHERE status = 'active' AND type = 'procedural' AND title LIKE ? LIMIT 10").all(`%${query}%`);
        }
      } else {
        rows = db.prepare("SELECT * FROM observations WHERE status = 'active' AND type = 'procedural' ORDER BY importance DESC, created_at DESC LIMIT 20").all();
      }
      if (jsonMode) { console.log(JSON.stringify(rows, null, 2)); break; }
      if (!rows.length) { console.log('(no results)'); break; }
      rows.forEach(printRow);
      break;
    }

    case 'stats': {
      const s = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM observations WHERE status = 'active' AND type = 'semantic') as semantic_active,
          (SELECT COUNT(*) FROM observations WHERE status != 'active' AND type = 'semantic') as semantic_inactive,
          (SELECT COUNT(*) FROM observations WHERE status = 'active' AND type = 'procedural') as procedural_active,
          (SELECT COUNT(*) FROM observations WHERE status = 'active' AND type = 'episodic') as episodic_active,
          (SELECT COUNT(*) FROM observations WHERE status = 'active' AND type NOT IN ('semantic','procedural','episodic')) as session_obs,
          (SELECT COUNT(DISTINCT category) FROM observations WHERE status = 'active' AND type = 'semantic') as categories,
          (SELECT COUNT(DISTINCT title) FROM observations WHERE status = 'active' AND type = 'semantic') as topics,
          (SELECT ROUND(AVG(importance), 2) FROM observations WHERE status = 'active' AND type = 'semantic') as avg_importance,
          (SELECT COUNT(*) FROM tool_events) as total_events,
          (SELECT COUNT(*) FROM tool_events WHERE compressed = 0) as uncompressed_events
      `).get();

      if (jsonMode) { console.log(JSON.stringify(s, null, 2)); break; }

      console.log(`=== Overlord Memory Stats (v2 SQLite) ===
Semantic:    ${s.semantic_active} active, ${s.semantic_inactive} archived
Procedural:  ${s.procedural_active} active
Episodic:    ${s.episodic_active} active
Session obs: ${s.session_obs}
Categories:  ${s.categories} (${s.topics} unique topics)
Avg Importance: ${s.avg_importance || 'N/A'}
Tool events: ${s.total_events} total, ${s.uncompressed_events} uncompressed`);

      const cats = db.prepare(`
        SELECT category, COUNT(*) as count, ROUND(AVG(importance), 2) as avg_imp
        FROM observations WHERE status = 'active' AND type = 'semantic'
        GROUP BY category ORDER BY count DESC
      `).all();
      if (cats.length) {
        console.log('\nCategories:');
        for (const c of cats) console.log(`  ${c.category}: ${c.count} (avg imp: ${c.avg_imp})`);
      }
      break;
    }

    case 'rebuild': {
      console.log('Rebuilding MEMORY.md from database...');
      const lines = [];
      lines.push('# Overlord Memory Index');
      lines.push('');
      lines.push('> Auto-generated from memory v2 DB. For deeper knowledge: `mem search <query>` or `mem recall <category>`');
      lines.push('');

      const sections = [
        { category: 'tool', heading: '## Tools', limit: 15 },
        { category: 'project', heading: '## Projects', limit: 10 },
        { category: 'infrastructure', heading: '## Infrastructure', limit: 8 },
        { category: 'security', heading: '## Security', limit: 5 },
        { category: 'integration', heading: '## Integrations', limit: 8 },
        { category: 'preference', heading: '## Preferences', limit: 5, noTopic: true },
      ];

      for (const sec of sections) {
        const rows = db.prepare(
          "SELECT title, narrative FROM observations WHERE status = 'active' AND type = 'semantic' AND category = ? ORDER BY importance DESC, access_count DESC LIMIT ?"
        ).all(sec.category, sec.limit);
        if (rows.length) {
          lines.push(sec.heading);
          for (const r of rows) {
            if (sec.noTopic) lines.push(`- ${(r.narrative || r.title).split('\n')[0].slice(0, 120)}`);
            else lines.push(`- **${r.title}**: ${(r.narrative || '').split('\n')[0].slice(0, 120)}`);
          }
          lines.push('');
        }
      }

      // Procedures
      const procs = db.prepare(
        "SELECT title, narrative FROM observations WHERE status = 'active' AND type = 'procedural' ORDER BY importance DESC LIMIT 5"
      ).all();
      if (procs.length) {
        lines.push('## Key Procedures');
        for (const p of procs) lines.push(`- **${p.title}**: ${(p.narrative || '').split('\n')[0].slice(0, 100)}`);
        lines.push('');
      }

      const output = lines.slice(0, 190).join('\n');
      const memPath = '/root/.claude/projects/-root/memory/MEMORY.md';
      try {
        // Preserve Claude Code memory section if it exists
        let preserved = '';
        try {
          const existing = readFileSync(memPath, 'utf-8');
          const ccMatch = existing.match(/## Claude Code Memories[\s\S]*?(?=\n## |\n> Auto-generated|$)/);
          if (ccMatch) preserved = ccMatch[0].trim() + '\n\n';
        } catch { /* no existing file */ }
        // Insert preserved section after the title
        const finalOutput = preserved
          ? output.replace('> Auto-generated', preserved + '> Auto-generated')
          : output;
        writeFileSync(memPath, finalOutput, 'utf-8');
        console.log(`Wrote ${lines.length} lines to ${memPath}${preserved ? ' (preserved Claude Code section)' : ''}`);
      } catch {
        const altPath = '/app/data/MEMORY.md';
        try {
          writeFileSync(altPath, output, 'utf-8');
          console.log(`Wrote ${lines.length} lines to ${altPath} (container mode)`);
        } catch (err) {
          console.error(`Failed to write MEMORY.md: ${err.message}`);
        }
      }
      break;
    }

    case 'consolidate': {
      console.log('Running full memory consolidation (v2)...');
      closeDb(); // Release DB before consolidator opens its own connection
      const { consolidate } = await import('../memory-consolidator.js');
      const report = await consolidate();
      console.log(`=== Memory Consolidation Report (v2) ===`);
      console.log(`Deduped:      ${report.deduped} merged duplicates`);
      console.log(`Decayed:      ${report.decayed} memories`);
      console.log(`Boosted:      ${report.boosted} memories`);
      console.log(`Pruned:       ${report.pruned} memories`);
      if (report.compressed?.observations) {
        console.log(`Compressed:   ${report.compressed.compressed} events -> ${report.compressed.observations} observations`);
      } else if (report.compressed?.skipped) {
        console.log(`Compressed:   ${report.compressed.skipped}`);
      }
      if (report.compressError) {
        console.log(`Compress err: ${report.compressError}`);
      }
      console.log(`Purged:       ${report.purged} old compressed events`);
      if (report.rebuild?.path) {
        console.log(`MEMORY.md:    ${report.rebuild.lines} lines -> ${report.rebuild.path}`);
      }
      if (report.stats) {
        console.log(`\nPost-consolidation: ${report.stats.semantic} semantic, ${report.stats.procedural} procedural (avg importance: ${report.stats.avg_importance})`);
      }
      if (report.error) {
        console.error(`Error: ${report.error}`);
        process.exit(1); // signal failure to cron/automation
      }
      process.exit(0); // consolidator already closed its DB
    }

    case 'context': {
      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      if (!query) { console.error('Usage: mem context <query>'); process.exit(1); }

      let results;
      try {
        results = db.prepare(`
          SELECT o.* FROM observations_fts fts JOIN observations o ON o.id = fts.rowid
          WHERE observations_fts MATCH ? AND o.status = 'active' AND o.type IN ('semantic','procedural')
          ORDER BY fts.rank LIMIT 10
        `).all(query);
      } catch {
        results = db.prepare(
          "SELECT * FROM observations WHERE status = 'active' AND type IN ('semantic','procedural') AND (title LIKE ? OR narrative LIKE ?) ORDER BY importance DESC LIMIT 10"
        ).all(`%${query}%`, `%${query}%`);
      }

      if (!results.length) { console.log(`(no system knowledge found for: ${query})`); break; }

      const sem = results.filter(r => r.type === 'semantic');
      const proc = results.filter(r => r.type === 'procedural');
      const lines = ['[SYSTEM KNOWLEDGE]'];

      for (const r of sem) {
        const bold = r.importance >= 0.8;
        lines.push(`- ${bold ? '**' : ''}[${r.category}/${r.title}]${bold ? '**' : ''} ${(r.narrative || '').split('\n')[0]}`);
      }
      if (proc.length) {
        lines.push('');
        lines.push('Relevant procedures:');
        for (const p of proc) lines.push(`- When "${p.title}": ${(p.narrative || '').split('\n')[0]}`);
      }
      console.log(lines.join('\n'));

      // Update access
      const updateStmt2 = db.prepare('UPDATE observations SET access_count = access_count + 1, last_accessed = ? WHERE id = ?');
      const now2 = Date.now();
      for (const r of results) updateStmt2.run(now2, r.id);
      break;
    }

    case 'associate': {
      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      if (!query) { console.error('Usage: mem associate <query>'); process.exit(1); }
      // In v2, associations are handled via parent_id and superseded_by
      // For now, just search and show related
      let results;
      try {
        results = db.prepare(`
          SELECT o.* FROM observations_fts fts JOIN observations o ON o.id = fts.rowid
          WHERE observations_fts MATCH ? AND o.status = 'active'
          ORDER BY fts.rank LIMIT 10
        `).all(query);
      } catch {
        results = [];
      }
      if (!results.length) { console.log('No results found.'); break; }
      for (const r of results) printRow(r);
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
} finally {
  closeDb();
}
