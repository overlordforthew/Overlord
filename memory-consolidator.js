/**
 * Memory Consolidator — Daily memory maintenance cycle (v2, SQLite-backed).
 * Inspired by human sleep memory processing:
 *   Decay -> Boost -> Prune -> Rebuild MEMORY.md
 *
 * Run via cron or manually: node memory-consolidator.js
 */

import { initSchema } from './skills/memory-v2/lib/schema.mjs';
import { getDb, closeDb } from './skills/memory-v2/lib/db.mjs';
import { purgeOldEvents, getUncompressedCount } from './skills/memory-v2/lib/events.mjs';
import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));

async function decay(db, now) {
  const thirtyDaysAgo = now - 30 * 24 * 3600 * 1000;
  let total = 0;

  // Tiered decay: different rates and floors by content type
  // Standing orders & corrections: barely decay (floor 0.70, rate 0.005)
  const { changes: c1 } = db.prepare(`
    UPDATE observations SET importance = MAX(importance - 0.005, 0.70), updated_at = ?
    WHERE status = 'active' AND (last_accessed IS NULL OR last_accessed < ?)
    AND importance > 0.70 AND tags LIKE '%standing-order%' OR tags LIKE '%correction%'
  `).run(now, thirtyDaysAgo);
  total += c1;

  // Decisions: moderate decay (floor 0.50, rate 0.01)
  const { changes: c2 } = db.prepare(`
    UPDATE observations SET importance = MAX(importance - 0.01, 0.50), updated_at = ?
    WHERE status = 'active' AND (last_accessed IS NULL OR last_accessed < ?)
    AND importance > 0.50 AND tags LIKE '%decision%'
    AND tags NOT LIKE '%standing-order%' AND tags NOT LIKE '%correction%'
  `).run(now, thirtyDaysAgo);
  total += c2;

  // Episodic person facts: slow decay (floor 0.20, rate 0.01)
  const { changes: c3 } = db.prepare(`
    UPDATE observations SET importance = MAX(importance - 0.01, 0.20), updated_at = ?
    WHERE status = 'active' AND type = 'episodic'
    AND (last_accessed IS NULL OR last_accessed < ?) AND importance > 0.20
    AND tags NOT LIKE '%standing-order%' AND tags NOT LIKE '%correction%' AND tags NOT LIKE '%decision%'
  `).run(now, thirtyDaysAgo);
  total += c3;

  // Trivia (importance < 0.30): fast decay (floor 0.05, rate 0.05)
  const { changes: c4 } = db.prepare(`
    UPDATE observations SET importance = MAX(importance - 0.05, 0.05), updated_at = ?
    WHERE status = 'active' AND importance < 0.30 AND importance > 0.05
    AND (last_accessed IS NULL OR last_accessed < ?)
    AND tags NOT LIKE '%standing-order%' AND tags NOT LIKE '%correction%'
  `).run(now, thirtyDaysAgo);
  total += c4;

  // Normal semantic/other: standard decay (floor 0.10, rate 0.02)
  const { changes: c5 } = db.prepare(`
    UPDATE observations SET importance = MAX(importance - 0.02, 0.10), updated_at = ?
    WHERE status = 'active' AND type IN ('semantic', 'procedural')
    AND (last_accessed IS NULL OR last_accessed < ?) AND importance > 0.10
  `).run(now, thirtyDaysAgo);
  total += c5;

  return total;
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

/**
 * Auto-merge near-duplicate episodic memories.
 * Groups by JID, finds pairs with high word overlap in title/narrative,
 * keeps the newer one and merges facts from the older.
 */
async function dedup(db, now) {
  // Get all active episodic memories grouped by JID
  const jids = db.prepare(
    "SELECT DISTINCT jid FROM observations WHERE status = 'active' AND type = 'episodic' AND jid IS NOT NULL"
  ).all();

  let merged = 0;

  for (const { jid } of jids) {
    const memories = db.prepare(
      "SELECT id, title, narrative, importance, created_at FROM observations WHERE status = 'active' AND type = 'episodic' AND jid = ? ORDER BY created_at DESC"
    ).all(jid);

    // Build word sets for each memory
    const wordSets = memories.map(m => {
      const text = `${m.title} ${m.narrative || ''}`.toLowerCase();
      return new Set(text.split(/\W+/).filter(w => w.length > 3));
    });

    // Find pairs with >60% word overlap (Jaccard similarity)
    const toMerge = new Set();
    for (let i = 0; i < memories.length && merged < 20; i++) {
      if (toMerge.has(memories[i].id)) continue;
      for (let j = i + 1; j < memories.length; j++) {
        if (toMerge.has(memories[j].id)) continue;

        const setA = wordSets[i];
        const setB = wordSets[j];
        let intersection = 0;
        for (const w of setA) { if (setB.has(w)) intersection++; }
        const union = setA.size + setB.size - intersection;
        const jaccard = union > 0 ? intersection / union : 0;

        if (jaccard > 0.6) {
          // Keep the newer one (i), archive the older (j)
          const keeper = memories[i];
          const loser = memories[j];

          // If loser has higher importance, boost keeper
          if (loser.importance > keeper.importance) {
            db.prepare('UPDATE observations SET importance = ?, updated_at = ? WHERE id = ?')
              .run(loser.importance, now, keeper.id);
          }

          // If loser narrative is longer, take it
          if ((loser.narrative || '').length > (keeper.narrative || '').length) {
            db.prepare('UPDATE observations SET narrative = ?, updated_at = ? WHERE id = ?')
              .run(loser.narrative, now, keeper.id);
          }

          // Archive loser
          db.prepare("UPDATE observations SET status = 'merged', superseded_by = ?, updated_at = ? WHERE id = ?")
            .run(keeper.id, now, loser.id);

          toMerge.add(loser.id);
          merged++;
        }
      }
    }
  }

  return merged;
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

  // Standing orders (high-importance episodic)
  const standingOrders = db.prepare(
    "SELECT title, narrative FROM observations WHERE status = 'active' AND type = 'episodic' AND importance >= 0.8 ORDER BY importance DESC LIMIT 10"
  ).all();
  if (standingOrders.length) {
    lines.push('## Standing Orders & Rules');
    for (const o of standingOrders) lines.push(`- ${(o.narrative || o.title).split('\n')[0].slice(0, 150)}`);
    lines.push('');
  }

  // Recent episodic context
  const recentEpisodic = db.prepare(
    "SELECT title, narrative, created_at FROM observations WHERE status = 'active' AND type = 'episodic' AND importance < 0.8 ORDER BY created_at DESC LIMIT 8"
  ).all();
  if (recentEpisodic.length) {
    lines.push('## Recent Context');
    for (const e of recentEpisodic) {
      const date = new Date(e.created_at).toISOString().slice(0, 10);
      lines.push(`- ${(e.narrative || e.title).split('\n')[0].slice(0, 120)} (${date})`);
    }
    lines.push('');
  }

  const output = lines.slice(0, 190).join('\n');
  // Write to both data/ (canonical) and project root (for Claude CLI sessions)
  const paths = [
    resolve(__dirname, 'data/MEMORY.md'),
    resolve(__dirname, 'MEMORY.md'),
  ];
  let writtenPath = null;
  for (const p of paths) {
    try {
      writeFileSync(p, output, 'utf-8');
      if (!writtenPath) writtenPath = p;
    } catch { /* skip unwritable paths */ }
  }
  return { path: writtenPath, lines: lines.length };
}

// ── MAIN CONSOLIDATION CYCLE ──────────────────────────────────────────────────

export async function consolidate() {
  initSchema();
  const db = getDb();
  const now = Date.now();
  const report = {};

  try {
    report.deduped = await dedup(db, now);
    report.decayed = await decay(db, now);
    report.boosted = await boost(db, now);
    report.pruned = await prune(db, now);
    // Compress unprocessed tool events into observations before purging
    const pending = getUncompressedCount();
    if (pending >= 50) {
      try {
        const { execSync } = await import('child_process');
        const compressScript = resolve(__dirname, 'skills/memory-v2/scripts/auto-compress.mjs');
        const out = execSync(`node "${compressScript}"`, {
          timeout: 60000, encoding: 'utf-8', cwd: __dirname
        });
        const match = out.match(/\{.*\}/);
        report.compressed = match ? JSON.parse(match[0]) : { compressed: pending };
      } catch (err) {
        report.compressError = err.message;
      }
    } else {
      report.compressed = { compressed: 0, skipped: `${pending} events below threshold` };
    }
    report.purged = purgeOldEvents(7);  // Delete compressed events older than 7 days

    // Truncate WAL file to reclaim disk space
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* non-critical */ }

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
    }
  } finally {
    closeDb();
  }
}
