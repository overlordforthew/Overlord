/**
 * Memory Consolidator — Daily memory maintenance cycle (v2, SQLite-backed).
 * Inspired by human sleep memory processing:
 *   Decay -> Boost -> Prune -> Rebuild MEMORY.md
 *
 * Run via cron or manually: node memory-consolidator.js
 */

import { initSchema } from './skills/memory-v2/lib/schema.mjs';
import { getDb, closeDb } from './skills/memory-v2/lib/db.mjs';
import { writeFileSync } from 'fs';

async function decay(db, now) {
  const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;
  const { changes } = db.prepare(`
    UPDATE observations SET importance = MAX(importance - 0.02, 0.1), updated_at = ?
    WHERE status = 'active' AND last_accessed < ? AND importance > 0.1
  `).run(now, thirtyDaysAgo);
  return changes;
}

async function boost(db, now) {
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;
  const { changes } = db.prepare(`
    UPDATE observations SET importance = MIN(importance + 0.05, 1.0), updated_at = ?
    WHERE status = 'active' AND access_count > 5 AND last_accessed > ? AND importance < 1.0
  `).run(now, sevenDaysAgo);
  return changes;
}

async function prune(db, now) {
  const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;
  const { changes } = db.prepare(`
    UPDATE observations SET status = 'archived', updated_at = ?
    WHERE status = 'active' AND importance < 0.15 AND access_count = 0 AND created_at < ?
  `).run(now, thirtyDaysAgo);
  return changes;
}

async function rebuildMemoryMd(db) {
  const lines = [];
  lines.push('# Overlord Memory Index');
  lines.push('');
  lines.push('> Auto-generated from memory v2 DB. Use `mem search <query>` or `mem recall <category>` for deeper knowledge.');
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
  initSchema();
  const db = getDb();
  const now = Date.now();
  const report = {};

  try {
    report.decayed = await decay(db, now);
    report.boosted = await boost(db, now);
    report.pruned = await prune(db, now);
    report.rebuild = await rebuildMemoryMd(db);

    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM observations WHERE status = 'active' AND type = 'semantic') as semantic,
        (SELECT COUNT(*) FROM observations WHERE status = 'active' AND type = 'procedural') as procedural,
        (SELECT ROUND(AVG(importance), 2) FROM observations WHERE status = 'active') as avg_importance
    `).get();
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
    console.log('=== Memory Consolidation Report (v2) ===');
    console.log(`Decayed:      ${report.decayed} memories`);
    console.log(`Boosted:      ${report.boosted} memories`);
    console.log(`Pruned:       ${report.pruned} memories`);
    if (report.rebuild?.path) {
      console.log(`MEMORY.md:    ${report.rebuild.lines} lines -> ${report.rebuild.path}`);
    }
    if (report.stats) {
      console.log(`\nPost-consolidation: ${report.stats.semantic} semantic, ${report.stats.procedural} procedural (avg importance: ${report.stats.avg_importance})`);
    }
    if (report.error) {
      console.error(`Error: ${report.error}`);
    }
  } finally {
    closeDb();
  }
}
