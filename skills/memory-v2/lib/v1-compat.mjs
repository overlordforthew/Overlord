/**
 * v1 Compatibility Adapter
 * Drop-in replacements for memory-store.js, semantic-store.js, memory-curator.js
 * backed by v2 SQLite observations table.
 */

import { initSchema } from './schema.mjs';
import { getDb } from './db.mjs';
import * as observations from './observations.mjs';
import { embed, search as vectorSearch, isAvailable as qdrantAvailable } from './embeddings.mjs';

// ── TOKEN BUDGET ────────────────────────────────────────────────────────────

export const TOKEN_BUDGET = {
  episodic: 1500,    // ~6KB text for memories
  semantic: 800,     // ~3.2KB for system knowledge
  conversation: 3000, // ~12KB for recent messages
  message: 1500,     // ~6KB for current message
  system: 1200,      // ~4.8KB for system prompt (fixed, not budgeted)
  total: 8000,       // total context budget
};

function estimateTokens(text) {
  return Math.ceil((text || '').length / 4);
}

function truncateToTokenBudget(items, budget, formatFn) {
  const result = [];
  let used = 0;
  for (const item of items) {
    const text = formatFn(item);
    const tokens = estimateTokens(text);
    if (used + tokens > budget) break;
    result.push(item);
    used += tokens;
  }
  return { items: result, tokensUsed: used };
}

// ── INIT ────────────────────────────────────────────────────────────────────

export async function ensureSchema() {
  initSchema();
}

export async function ensureSemanticSchema() {
  initSchema();
}

// ── EPISODIC: storeMemory ────────────────────────────────────────────────────

export async function storeMemory({ jid, content, summary, tags = [], importance = 5, source = 'auto', category }) {
  initSchema();
  const db = getDb();

  // Dedup: check for very similar title+narrative for this jid
  const existing = db.prepare(
    "SELECT id FROM observations WHERE jid = ? AND status = 'active' AND title = ? LIMIT 1"
  ).get(jid, summary?.slice(0, 255) || content.slice(0, 60));
  if (existing) return existing.id;

  // Derive category from tags if not explicitly provided
  const resolvedCategory = category || categoryFromTags(tags);

  return observations.store({
    jid,
    type: 'episodic',
    title: (summary || content.slice(0, 60)).trim(),
    narrative: content.trim(),
    tags: Array.isArray(tags) ? tags : [],
    importance: importance / 10, // v1 uses 1-10, v2 uses 0.0-1.0
    source,
    category: resolvedCategory,
  });
}

const TAG_CATEGORY_MAP = {
  'standing-order': 'preference', correction: 'preference', preference: 'preference',
  rule: 'rule', decision: 'rule',
  project: 'project', person: 'person',
  error: 'infrastructure', infrastructure: 'infrastructure',
  tool: 'tool', pattern: 'pattern', security: 'security',
};

function categoryFromTags(tags) {
  if (!Array.isArray(tags) || tags.length === 0) return 'general';
  for (const tag of tags) {
    if (TAG_CATEGORY_MAP[tag]) return TAG_CATEGORY_MAP[tag];
  }
  return 'general';
}

export async function storeManyMemories(memories) {
  for (const m of memories) {
    await storeMemory(m);
  }
}

// ── EPISODIC: retrieveMemories ───────────────────────────────────────────────

export async function retrieveMemories(jid, { query = '', limit = 20 } = {}) {
  initSchema();
  const db = getDb();

  // 1. Critical memories (importance >= 0.8) — ALWAYS included
  const critical = db.prepare(
    "SELECT * FROM observations WHERE jid = ? AND status = 'active' AND type = 'episodic' AND importance >= 0.8 ORDER BY importance DESC LIMIT 10"
  ).all(jid);

  // 2. FTS keyword search
  let ftsRows = [];
  if (query && query.length > 3) {
    try {
      ftsRows = db.prepare(`
        SELECT o.*, fts.rank as fts_rank FROM observations_fts fts
        JOIN observations o ON o.id = fts.rowid
        WHERE observations_fts MATCH ? AND o.jid = ? AND o.status = 'active' AND o.type = 'episodic'
        ORDER BY fts.rank LIMIT ?
      `).all(query, jid, limit);
    } catch { /* FTS query syntax error — skip */ }
  }

  // 3. Vector semantic search (NEW — Qdrant)
  let vectorRows = [];
  if (query && query.length > 3 && await qdrantAvailable()) {
    try {
      const queryVec = await embed(query);
      if (queryVec) {
        const filter = { must: [{ key: 'jid', match: { value: jid } }, { key: 'type', match: { value: 'episodic' } }] };
        const vResults = await vectorSearch(queryVec, limit, filter);
        // Fetch full rows from SQLite for vector matches
        for (const vr of vResults) {
          if (vr.score >= 0.4) { // minimum relevance threshold
            const row = db.prepare('SELECT * FROM observations WHERE id = ? AND status = ?').get(vr.id, 'active');
            if (row) vectorRows.push({ ...row, _vectorScore: vr.score });
          }
        }
      }
    } catch { /* Vector search failed — continue with FTS only */ }
  }

  // 4. Recent memories
  const recent = db.prepare(
    "SELECT * FROM observations WHERE jid = ? AND status = 'active' AND type = 'episodic' ORDER BY last_accessed DESC, importance DESC LIMIT ?"
  ).all(jid, limit);

  // 5. Merge + hybrid re-rank
  const seen = new Set();
  const candidates = [];

  // Add all sources
  for (const row of critical) {
    if (!seen.has(row.id)) { seen.add(row.id); candidates.push({ ...row, _source: 'critical' }); }
  }
  for (const row of ftsRows) {
    if (!seen.has(row.id)) { seen.add(row.id); candidates.push({ ...row, _source: 'fts' }); }
    else { const c = candidates.find(c => c.id === row.id); if (c) c._ftsRank = row.fts_rank; }
  }
  for (const row of vectorRows) {
    if (!seen.has(row.id)) { seen.add(row.id); candidates.push({ ...row, _source: 'vector' }); }
    else { const c = candidates.find(c => c.id === row.id); if (c) c._vectorScore = row._vectorScore; }
  }
  for (const row of recent) {
    if (!seen.has(row.id)) { seen.add(row.id); candidates.push({ ...row, _source: 'recent' }); }
  }

  // Hybrid scoring: vector 40%, importance 30%, keyword 15%, recency 10%, access 5%
  const now = Date.now();
  const scored = candidates.map(c => {
    let score = 0;
    score += (c._vectorScore || 0) * 40;              // vector similarity (0-1 * 40)
    score += (c.importance || 0.5) * 30;                // importance (0-1 * 30)
    if (c._ftsRank) score += Math.min(15, -c._ftsRank); // FTS rank (negative = better)
    const age = now - (c.created_at || 0);
    if (age < 7 * 86400000) score += 10;                // recency bonus
    if ((c.access_count || 0) > 5) score += 5;          // frequently accessed
    if (c._source === 'critical') score += 20;           // critical always boosted
    return { ...c, _hybridScore: score };
  });

  scored.sort((a, b) => b._hybridScore - a._hybridScore);
  const merged = scored.slice(0, limit).map(toEpisodicFormat);

  // Update access stats
  const updateStmt = db.prepare('UPDATE observations SET access_count = access_count + 1, last_accessed = ? WHERE id = ?');
  for (const m of merged) updateStmt.run(now, m.id);

  return merged;
}

// ── EPISODIC: formatMemoriesForPrompt ────────────────────────────────────────

export function formatMemoriesForPrompt(memories) {
  if (!memories.length) return '(No memories stored yet)';

  const critical = memories.filter(m => m.importance >= 8);
  const other = memories.filter(m => m.importance < 8);
  const lines = [];
  let tokensUsed = 0;

  // Critical facts always included (standing orders, corrections)
  if (critical.length) {
    lines.push('## Standing Orders & Critical Facts');
    tokensUsed += estimateTokens(lines[0]);
    for (const m of critical) {
      const line = `- ${m.content}`;
      tokensUsed += estimateTokens(line);
      lines.push(line);
    }
  }

  // Other facts — budget-aware
  if (other.length) {
    lines.push('## Context');
    tokensUsed += estimateTokens('## Context');
    let included = 0;
    for (const m of other) {
      const line = `- ${m.content}`;
      const lineTokens = estimateTokens(line);
      if (tokensUsed + lineTokens > TOKEN_BUDGET.episodic) {
        lines.push(`- [...${other.length - included} more items truncated]`);
        break;
      }
      lines.push(line);
      tokensUsed += lineTokens;
      included++;
    }
  }

  return lines.join('\n');
}

// ── EPISODIC: seedFromLegacyFile ─────────────────────────────────────────────

export async function seedFromLegacyFile(jid, legacyMarkdown) {
  initSchema();
  const db = getDb();

  // Check if already seeded (use metadata to track)
  const existing = db.prepare(
    "SELECT id FROM observations WHERE jid = ? AND source = 'seed' LIMIT 1"
  ).get(jid);
  if (existing) return false;

  const lines = legacyMarkdown
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('_') && l.length > 10);

  const memories = lines.map(line => ({
    jid,
    content: line.replace(/^[-*]\s*/, ''),
    summary: line.replace(/^[-*]\s*/, '').slice(0, 60),
    tags: inferTags(line),
    importance: inferImportance(line),
    source: 'seed',
  }));

  for (const m of memories) await storeMemory(m);
  return memories.length;
}

// ── EPISODIC: listMemories ───────────────────────────────────────────────────

export async function listMemories(jid, { tag, limit = 30 } = {}) {
  initSchema();
  const db = getDb();

  let sql = "SELECT * FROM observations WHERE jid = ? AND status = 'active' AND type = 'episodic'";
  const params = [jid];

  if (tag) {
    sql += " AND tags LIKE ?";
    params.push(`%"${tag}"%`);
  }

  sql += ' ORDER BY importance DESC, last_accessed DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params).map(toEpisodicFormat);
}

// ── EPISODIC: deleteMemory ───────────────────────────────────────────────────

export async function deleteMemory(id, jid) {
  initSchema();
  const db = getDb();
  db.prepare("UPDATE observations SET status = 'archived', updated_at = ? WHERE id = ? AND jid = ?")
    .run(Date.now(), id, jid);
}

// ── EPISODIC: clearMemories ──────────────────────────────────────────────────

export async function clearMemories(jid) {
  initSchema();
  const db = getDb();
  db.prepare("UPDATE observations SET status = 'archived', updated_at = ? WHERE jid = ? AND status = 'active'")
    .run(Date.now(), jid);
}

// ── EPISODIC: getMemoryStats ─────────────────────────────────────────────────

export async function getMemoryStats(jid) {
  initSchema();
  const db = getDb();
  const row = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN importance >= 0.8 THEN 1 ELSE 0 END) as critical,
      SUM(CASE WHEN source = 'auto' THEN 1 ELSE 0 END) as auto_extracted,
      SUM(CASE WHEN source = 'seed' THEN 1 ELSE 0 END) as seeded,
      MAX(created_at) as newest,
      MIN(created_at) as oldest
    FROM observations
    WHERE jid = ? AND status = 'active' AND type = 'episodic'
  `).get(jid);

  return {
    ...row,
    newest: row.newest ? new Date(row.newest).toISOString() : null,
    oldest: row.oldest ? new Date(row.oldest).toISOString() : null,
  };
}

// ── SEMANTIC: saveSemantic ───────────────────────────────────────────────────

export async function saveSemantic({ category, topic, content, summary, importance = 0.5, confidence = 1.0, source = 'manual', tags = [], project = null }) {
  initSchema();
  const db = getDb();

  // Dedup: update if same category+topic exists
  const existing = db.prepare(
    "SELECT id FROM observations WHERE category = ? AND title = ? AND status = 'active' AND type = 'semantic' LIMIT 1"
  ).get(category, topic);

  if (existing) {
    observations.update(existing.id, {
      narrative: content.trim(),
      subtitle: summary || content.trim().slice(0, 60),
      importance,
      confidence,
      tags: Array.isArray(tags) ? tags : [],
      project,
    });
    return existing.id;
  }

  return observations.store({
    type: 'semantic',
    category,
    title: topic,
    subtitle: summary || content.trim().slice(0, 60),
    narrative: content.trim(),
    importance,
    confidence,
    source,
    tags: Array.isArray(tags) ? tags : [],
    project,
  });
}

// ── SEMANTIC: searchSemantic ─────────────────────────────────────────────────

export async function searchSemantic(query, { limit = 10, category = null } = {}) {
  initSchema();
  const db = getDb();

  let sql = `
    SELECT o.*, fts.rank FROM observations_fts fts
    JOIN observations o ON o.id = fts.rowid
    WHERE observations_fts MATCH ? AND o.status = 'active' AND o.type = 'semantic'
  `;
  const params = [query];

  if (category) {
    sql += ' AND o.category = ?';
    params.push(category);
  }

  sql += ' ORDER BY fts.rank LIMIT ?';
  params.push(limit);

  try {
    const rows = db.prepare(sql).all(...params);
    return rows.map(toSemanticFormat);
  } catch {
    // FTS query syntax error — try LIKE fallback
    let fallback = "SELECT * FROM observations WHERE status = 'active' AND type = 'semantic' AND (title LIKE ? OR narrative LIKE ?)";
    const likeQ = `%${query}%`;
    const fparams = [likeQ, likeQ];
    if (category) {
      fallback += ' AND category = ?';
      fparams.push(category);
    }
    fallback += ` ORDER BY importance DESC LIMIT ?`;
    fparams.push(limit);
    return db.prepare(fallback).all(...fparams).map(toSemanticFormat);
  }
}

// ── SEMANTIC: getSemanticContext ──────────────────────────────────────────────

export async function getSemanticContext(query) {
  if (!query || query.length < 3) return '';

  try {
    // FTS results
    let ftsResults = await searchSemantic(query, { limit: 10 });

    // If few FTS results, try individual words
    if (ftsResults.length < 3) {
      const stopWords = new Set(['this','that','what','with','from','have','been','will','your','they','them','than','when','where','which','there','their','about','would','could','should','these','those','being','other','after','before','between','under','above','into','each','some','more','also','just','only']);
      const words = query.toLowerCase().split(/\W+/).filter(w => w.length >= 4 && !stopWords.has(w));
      const seen = new Set(ftsResults.map(r => r.id));
      for (const word of words.slice(0, 3)) {
        const extra = await searchSemantic(word, { limit: 5 });
        for (const r of extra) {
          if (!seen.has(r.id)) { seen.add(r.id); ftsResults.push(r); }
        }
      }
    }

    // Vector search (NEW)
    let vectorResults = [];
    if (await qdrantAvailable()) {
      try {
        const queryVec = await embed(query);
        if (queryVec) {
          const filter = { must: [{ key: 'type', match: { value: 'semantic' } }] };
          const vResults = await vectorSearch(queryVec, 10, filter);
          initSchema();
          const db = getDb();
          for (const vr of vResults) {
            if (vr.score >= 0.4) {
              const row = db.prepare('SELECT * FROM observations WHERE id = ? AND status = ?').get(vr.id, 'active');
              if (row) vectorResults.push({ ...toSemanticFormat(row), _vectorScore: vr.score });
            }
          }
        }
      } catch { /* vector search failed — continue with FTS */ }
    }

    // Merge FTS + vector results
    const seen = new Set();
    const merged = [];
    for (const r of [...ftsResults, ...vectorResults]) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      } else {
        // If already seen, merge vector score
        const existing = merged.find(m => m.id === r.id);
        if (existing && r._vectorScore) existing._vectorScore = r._vectorScore;
      }
    }

    // Hybrid re-rank
    merged.sort((a, b) => {
      const scoreA = (a._vectorScore || 0) * 40 + (a.importance || 0.5) * 30;
      const scoreB = (b._vectorScore || 0) * 40 + (b.importance || 0.5) * 30;
      return scoreB - scoreA;
    });

    const results = merged.slice(0, 10);
    if (!results.length) return '';

    // Token budget enforcement
    const lines = ['## System Knowledge'];
    let tokensUsed = estimateTokens(lines[0]);
    for (const r of results) {
      const prefix = r.importance >= 0.8 ? '**' : '';
      const suffix = r.importance >= 0.8 ? '**' : '';
      const line = `- ${prefix}[${r.category}/${r.topic}]${suffix} ${r.content}`;
      const lineTokens = estimateTokens(line);
      if (tokensUsed + lineTokens > TOKEN_BUDGET.semantic) {
        lines.push(`- [...${results.length - lines.length + 1} more items truncated by token budget]`);
        break;
      }
      lines.push(line);
      tokensUsed += lineTokens;
    }
    return lines.join('\n');
  } catch (err) {
    return '';
  }
}

// ── SEMANTIC: recallByCategory ───────────────────────────────────────────────

export async function recallByCategory(category, { topic = null, limit = 20 } = {}) {
  initSchema();
  const db = getDb();

  let sql = "SELECT * FROM observations WHERE status = 'active' AND type = 'semantic' AND category = ?";
  const params = [category];
  if (topic) { sql += ' AND title = ?'; params.push(topic); }
  sql += ' ORDER BY importance DESC, access_count DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params).map(toSemanticFormat);
}

// ── SEMANTIC: other CRUD ─────────────────────────────────────────────────────

export async function updateSemantic(id, content) {
  observations.update(id, { narrative: content.trim(), subtitle: content.trim().slice(0, 60) });
}

export async function getSemantic(id) {
  const obs = observations.getById(id);
  return obs ? toSemanticFormat(obs) : null;
}

export async function forgetSemantic(id) {
  observations.archive(id, { reason: 'forgotten via mem forget' });
}

export async function strengthenSemantic(id) {
  const obs = observations.getById(id);
  if (obs) {
    const newImp = Math.min((obs.importance || 0.5) + 0.1, 1.0);
    observations.update(id, { importance: newImp });
  }
}

export async function weakenSemantic(id) {
  const obs = observations.getById(id);
  if (obs) {
    const newImp = Math.max((obs.importance || 0.5) - 0.1, 0.1);
    observations.update(id, { importance: newImp });
  }
}

// ── SEMANTIC: stats ──────────────────────────────────────────────────────────

export async function getSemanticStats() {
  initSchema();
  const db = getDb();
  return db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM observations WHERE status = 'active' AND type = 'semantic') as semantic_total,
      (SELECT COUNT(*) FROM observations WHERE status = 'active' AND type = 'procedural') as procedural_total,
      0 as association_total,
      (SELECT COUNT(DISTINCT category) FROM observations WHERE status = 'active' AND type = 'semantic') as categories,
      (SELECT COUNT(DISTINCT title) FROM observations WHERE status = 'active' AND type = 'semantic') as topics,
      (SELECT AVG(importance) FROM observations WHERE status = 'active' AND type = 'semantic') as avg_importance,
      (SELECT MAX(updated_at) FROM observations WHERE type = 'semantic') as last_updated
  `).get();
}

export async function getCategoryBreakdown() {
  initSchema();
  const db = getDb();
  return db.prepare(`
    SELECT category, COUNT(*) as count, ROUND(AVG(importance), 2) as avg_importance
    FROM observations WHERE status = 'active' AND type = 'semantic'
    GROUP BY category ORDER BY count DESC
  `).all();
}

// ── PROCEDURAL ───────────────────────────────────────────────────────────────

export async function saveProcedural({ trigger_pattern, procedure, category = 'ops', project = null }) {
  return observations.store({
    type: 'procedural',
    title: trigger_pattern,
    narrative: procedure,
    category,
    project,
    metadata: { success_count: 0, failure_count: 0 },
  });
}

export async function searchProcedural(query, { limit = 10 } = {}) {
  initSchema();
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT o.* FROM observations_fts fts
      JOIN observations o ON o.id = fts.rowid
      WHERE observations_fts MATCH ? AND o.status = 'active' AND o.type = 'procedural'
      ORDER BY fts.rank LIMIT ?
    `).all(query, limit);
    return rows.map(toProceduralFormat);
  } catch {
    return db.prepare(
      "SELECT * FROM observations WHERE status = 'active' AND type = 'procedural' AND (title LIKE ? OR narrative LIKE ?) ORDER BY importance DESC LIMIT ?"
    ).all(`%${query}%`, `%${query}%`, limit).map(toProceduralFormat);
  }
}

export async function listProcedural({ limit = 20 } = {}) {
  initSchema();
  const db = getDb();
  return db.prepare(
    "SELECT * FROM observations WHERE status = 'active' AND type = 'procedural' ORDER BY importance DESC, created_at DESC LIMIT ?"
  ).all(limit).map(toProceduralFormat);
}

export async function recordProceduralOutcome(id, success) {
  const obs = observations.getById(id);
  if (!obs) return;
  const meta = obs.metadata ? JSON.parse(obs.metadata) : {};
  if (success) meta.success_count = (meta.success_count || 0) + 1;
  else meta.failure_count = (meta.failure_count || 0) + 1;
  observations.update(id, { metadata: JSON.stringify(meta) });
}

// ── ASSOCIATIONS (stub — v2 doesn't have a separate table yet) ───────────────

export async function createAssociation() { return 0; }
export async function getAssociations() { return []; }

// ── CURATOR: extractAndStore ─────────────────────────────────────────────────

// Re-exported from memory-curator.js but with v2 storage
// The actual extraction logic (LLM call) stays in memory-curator.js
// This module provides the storage functions it needs

// ── CURATOR: scoreRelevance ──────────────────────────────────────────────────

export function scoreRelevance(memories, currentMessage, limit = 15) {
  if (memories.length <= limit) return memories;

  const words = new Set(
    currentMessage.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  );

  const scored = memories.map(m => {
    let score = m.importance || 5;
    const mWords = (m.content || '').toLowerCase().split(/\W+/);
    const overlap = mWords.filter(w => words.has(w)).length;
    score += overlap * 2;
    const age = Date.now() - new Date(m.created_at).getTime();
    if (age < 7 * 24 * 3600 * 1000) score += 1;
    if (m.access_count > 5) score += 1;
    return { ...m, _score: score };
  });

  return scored.sort((a, b) => b._score - a._score).slice(0, limit);
}

// ── FORMAT CONVERTERS ────────────────────────────────────────────────────────

function toEpisodicFormat(obs) {
  const tags = obs.tags ? JSON.parse(obs.tags) : [];
  return {
    id: obs.id,
    jid: obs.jid,
    content: obs.narrative || obs.title,
    summary: obs.title,
    tags,
    importance: Math.round((obs.importance || 0.5) * 10), // v2 0-1 → v1 1-10
    source: obs.source,
    created_at: obs.created_at ? new Date(obs.created_at).toISOString() : null,
    last_accessed: obs.last_accessed ? new Date(obs.last_accessed).toISOString() : null,
    access_count: obs.access_count || 0,
  };
}

function toSemanticFormat(obs) {
  const tags = obs.tags ? JSON.parse(obs.tags) : [];
  return {
    id: obs.id,
    category: obs.category || 'general',
    topic: obs.title,
    content: obs.narrative || obs.title,
    summary: obs.subtitle || obs.title,
    importance: obs.importance,
    confidence: obs.confidence,
    source: obs.source,
    tags,
    project: obs.project,
    created_at: obs.created_at ? new Date(obs.created_at).toISOString() : null,
    updated_at: obs.updated_at ? new Date(obs.updated_at).toISOString() : null,
    last_accessed: obs.last_accessed ? new Date(obs.last_accessed).toISOString() : null,
    access_count: obs.access_count || 0,
  };
}

function toProceduralFormat(obs) {
  const meta = obs.metadata ? JSON.parse(obs.metadata) : {};
  return {
    id: obs.id,
    trigger_pattern: obs.title,
    procedure: obs.narrative || '',
    category: obs.category || 'ops',
    project: obs.project,
    success_count: meta.success_count || 0,
    failure_count: meta.failure_count || 0,
    last_used: obs.last_accessed ? new Date(obs.last_accessed).toISOString() : null,
  };
}

// ── TAG/IMPORTANCE INFERENCE (from v1) ───────────────────────────────────────

function inferTags(text) {
  const t = text.toLowerCase();
  const tags = [];
  if (/prefer|always|never|want|like|hate|permanent/i.test(t)) tags.push('preference');
  if (/project|deploy|docker|container|domain|server|repo/i.test(t)) tags.push('project');
  if (/error|broke|failed|fix|bug/i.test(t)) tags.push('error');
  if (/person|contact|friend|family|son|wife/i.test(t)) tags.push('person');
  if (/rule|must|never|every|always/i.test(t)) tags.push('rule');
  if (/boat|catana|yanmar|signalk|engine|battery/i.test(t)) tags.push('boat');
  if (/youtube|channel|video|content/i.test(t)) tags.push('content');
  if (tags.length === 0) tags.push('fact');
  return tags;
}

function inferImportance(text) {
  const t = text.toLowerCase();
  if (/permanent|standing order|never|critical|must|rule:/i.test(t)) return 9;
  if (/prefer|every project|always|important/i.test(t)) return 7;
  if (/contact|family|son/i.test(t)) return 6;
  return 5;
}
