#!/usr/bin/env node
/**
 * embed-existing.mjs — Migrate all active observations into Qdrant
 *
 * 1. Creates the 'observations' collection (768-dim, cosine, int8)
 * 2. Reads all active observations from SQLite
 * 3. Batch embeds via Gemini (100 at a time)
 * 4. Upserts all vectors to Qdrant
 *
 * Idempotent: safe to re-run. Existing points are overwritten.
 *
 * Usage: node scripts/embed-existing.mjs [--dry-run]
 */

import { getDb, closeDb } from '../skills/memory-v2/lib/db.mjs';
import { initSchema } from '../skills/memory-v2/lib/schema.mjs';
import {
  initCollection, embedBatch, upsertBatch, collectionInfo,
  observationToText, observationToPayload, search, embed,
} from '../skills/memory-v2/lib/embeddings.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('=== Embed Existing Observations ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`);

  // 1. Init collection
  const ok = await initCollection();
  if (!ok && !DRY_RUN) {
    console.error('FATAL: Could not create/verify Qdrant collection');
    process.exit(1);
  }

  // 2. Read all active observations
  initSchema();
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, type, category, title, subtitle, narrative, facts, importance, jid, status
    FROM observations
    WHERE status = 'active'
    ORDER BY id
  `).all();

  console.log(`Found ${rows.length} active observations\n`);

  if (DRY_RUN) {
    for (const r of rows.slice(0, 5)) {
      console.log(`  [${r.id}] ${r.type}/${r.category || '-'}: ${r.title?.slice(0, 60)}`);
      console.log(`    Text: ${observationToText(r).slice(0, 100)}...`);
    }
    console.log(`  ... and ${Math.max(0, rows.length - 5)} more`);
    closeDb();
    return;
  }

  // 3. Batch embed
  const texts = rows.map(r => observationToText(r));
  console.log(`Embedding ${texts.length} observations in batches of 100...`);

  const vectors = await embedBatch(texts);

  let embedded = 0;
  let failed = 0;
  for (let i = 0; i < vectors.length; i++) {
    if (vectors[i]) embedded++;
    else failed++;
  }
  console.log(`Embedded: ${embedded} | Failed: ${failed}\n`);

  // 4. Upsert to Qdrant
  const points = [];
  for (let i = 0; i < rows.length; i++) {
    if (!vectors[i]) continue;
    points.push({
      id: rows[i].id,
      vector: vectors[i],
      payload: observationToPayload(rows[i]),
    });
  }

  console.log(`Upserting ${points.length} points to Qdrant...`);
  const success = await upsertBatch(points);
  if (!success) {
    console.error('FATAL: Qdrant upsert failed');
    closeDb();
    process.exit(1);
  }

  // 5. Verify
  const info = await collectionInfo();
  console.log(`\nCollection info: ${JSON.stringify({
    points: info?.points_count,
    vectors: info?.vectors_count,
    status: info?.status,
  })}`);

  console.log('\n=== Migration complete ===');
  closeDb();
}

main().catch(err => {
  console.error('Migration error:', err);
  process.exit(1);
});
