import { getDb } from './db.mjs';
import { initSchema } from './schema.mjs';

export function store(obs) {
  initSchema();
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO observations (
      session_id, project, type, title, subtitle, narrative,
      facts, concepts, files_read, files_modified,
      outcome, outcome_note, depth, parent_id,
      source, tags, importance, confidence,
      jid, category, metadata,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?
    )
  `);

  const result = stmt.run(
    obs.session_id || null,
    obs.project || null,
    obs.type,
    obs.title,
    obs.subtitle || null,
    obs.narrative || null,
    toJson(obs.facts),
    toJson(obs.concepts),
    toJson(obs.files_read),
    toJson(obs.files_modified),
    obs.outcome || null,
    obs.outcome_note || null,
    obs.depth || 0,
    obs.parent_id || null,
    obs.source || 'hook',
    toJson(obs.tags),
    obs.importance ?? 0.5,
    obs.confidence ?? 1.0,
    obs.jid || null,
    obs.category || null,
    obs.metadata ? JSON.stringify(obs.metadata) : null,
    now, now
  );

  const id = result.lastInsertRowid;

  // Log mutation
  logMutation(db, id, 'create', null, obs, null, obs.session_id);

  // Update session observation count
  if (obs.session_id) {
    db.prepare(`
      UPDATE sessions SET observation_count = observation_count + 1
      WHERE id = ?
    `).run(obs.session_id);
  }

  return id;
}

export function search(query, { project, limit = 20 } = {}) {
  initSchema();
  const db = getDb();

  let sql = `
    SELECT o.*, fts.rank
    FROM observations_fts fts
    JOIN observations o ON o.id = fts.rowid
    WHERE observations_fts MATCH ?
      AND o.status = 'active'
  `;
  const params = [query];

  if (project) {
    sql += ' AND o.project = ?';
    params.push(project);
  }

  sql += ' ORDER BY fts.rank LIMIT ?';
  params.push(limit);

  const results = db.prepare(sql).all(...params);

  // Update access counts
  const updateStmt = db.prepare('UPDATE observations SET access_count = access_count + 1, last_accessed = ? WHERE id = ?');
  const now = Date.now();
  for (const r of results) {
    updateStmt.run(now, r.id);
  }

  return results;
}

export function getById(id) {
  initSchema();
  const db = getDb();
  return db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
}

export function getRecent({ project, limit = 10, type, status = 'active' } = {}) {
  initSchema();
  const db = getDb();

  let sql = 'SELECT * FROM observations WHERE status = ?';
  const params = [status];

  if (project) {
    sql += ' AND project = ?';
    params.push(project);
  }
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  return db.prepare(sql).all(...params);
}

export function update(id, fields, { reason, session_id } = {}) {
  initSchema();
  const db = getDb();

  const existing = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  if (!existing) throw new Error(`Observation ${id} not found`);

  const allowed = [
    'title', 'subtitle', 'narrative', 'facts', 'concepts',
    'files_read', 'files_modified', 'outcome', 'outcome_note',
    'type', 'project', 'importance', 'confidence', 'tags',
    'category', 'metadata', 'status'
  ];

  const setClauses = [];
  const params = [];

  for (const [key, value] of Object.entries(fields)) {
    if (!allowed.includes(key)) continue;
    setClauses.push(`${key} = ?`);
    const jsonFields = ['facts', 'concepts', 'files_read', 'files_modified', 'tags'];
    params.push(jsonFields.includes(key) ? toJson(value) : value);
  }

  if (setClauses.length === 0) return existing;

  setClauses.push('updated_at = ?');
  params.push(Date.now());
  params.push(id);

  db.prepare(`UPDATE observations SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);

  logMutation(db, id, 'update', existing, fields, reason, session_id);

  return db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
}

export function supersede(id, { reason, session_id, replacement_id } = {}) {
  initSchema();
  const db = getDb();

  const existing = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  if (!existing) throw new Error(`Observation ${id} not found`);

  db.prepare(`
    UPDATE observations SET status = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?
  `).run(replacement_id || null, Date.now(), id);

  logMutation(db, id, 'supersede', existing, { status: 'superseded', superseded_by: replacement_id }, reason, session_id);
}

export function archive(id, { reason, session_id } = {}) {
  initSchema();
  const db = getDb();

  const existing = db.prepare('SELECT * FROM observations WHERE id = ?').get(id);
  if (!existing) throw new Error(`Observation ${id} not found`);

  db.prepare("UPDATE observations SET status = 'archived', updated_at = ? WHERE id = ?").run(Date.now(), id);

  logMutation(db, id, 'archive', existing, { status: 'archived' }, reason, session_id);
}

export function merge(id1, id2, { session_id } = {}) {
  initSchema();
  const db = getDb();

  const obs1 = db.prepare('SELECT * FROM observations WHERE id = ?').get(id1);
  const obs2 = db.prepare('SELECT * FROM observations WHERE id = ?').get(id2);
  if (!obs1 || !obs2) throw new Error('One or both observations not found');

  // Merge: combine facts, concepts, keep newer narrative
  const facts1 = parseJson(obs1.facts) || [];
  const facts2 = parseJson(obs2.facts) || [];
  const concepts1 = parseJson(obs1.concepts) || [];
  const concepts2 = parseJson(obs2.concepts) || [];

  const mergedFacts = [...new Set([...facts1, ...facts2])];
  const mergedConcepts = [...new Set([...concepts1, ...concepts2])];

  const newer = obs1.created_at > obs2.created_at ? obs1 : obs2;
  const older = newer === obs1 ? obs2 : obs1;

  const now = Date.now();

  // Update the newer one with merged data
  db.prepare(`
    UPDATE observations SET
      facts = ?, concepts = ?,
      narrative = CASE WHEN ? IS NOT NULL THEN ? ELSE narrative END,
      updated_at = ?
    WHERE id = ?
  `).run(
    JSON.stringify(mergedFacts), JSON.stringify(mergedConcepts),
    newer.narrative, newer.narrative,
    now, newer.id
  );

  // Mark older as merged
  db.prepare("UPDATE observations SET status = 'merged', superseded_by = ?, updated_at = ? WHERE id = ?")
    .run(newer.id, now, older.id);

  logMutation(db, newer.id, 'merge', obs1, { merged_from: older.id }, `Merged with #${older.id}`, session_id);
  logMutation(db, older.id, 'merge', obs2, { merged_into: newer.id }, `Merged into #${newer.id}`, session_id);

  return newer.id;
}

export function getHistory(observationId) {
  initSchema();
  const db = getDb();
  return db.prepare(`
    SELECT * FROM observation_mutations
    WHERE observation_id = ?
    ORDER BY timestamp ASC
  `).all(observationId);
}

export function getStats() {
  initSchema();
  const db = getDb();

  const totalObs = db.prepare("SELECT COUNT(*) as cnt FROM observations WHERE status = 'active'").get().cnt;
  const totalEvents = db.prepare('SELECT COUNT(*) as cnt FROM tool_events').get().cnt;
  const uncompressed = db.prepare('SELECT COUNT(*) as cnt FROM tool_events WHERE compressed = 0').get().cnt;
  const byType = db.prepare("SELECT type, COUNT(*) as cnt FROM observations WHERE status = 'active' GROUP BY type").all();
  const byProject = db.prepare("SELECT project, COUNT(*) as cnt FROM observations WHERE status = 'active' AND project IS NOT NULL GROUP BY project").all();
  const recentSessions = db.prepare('SELECT * FROM sessions ORDER BY last_activity DESC LIMIT 5').all();

  return { totalObs, totalEvents, uncompressed, byType, byProject, recentSessions };
}

export function getSessions(limit = 10) {
  initSchema();
  const db = getDb();
  return db.prepare('SELECT * FROM sessions ORDER BY last_activity DESC LIMIT ?').all(limit);
}

// Helpers

function toJson(val) {
  if (val == null) return null;
  if (typeof val === 'string') {
    // Already JSON string?
    try { JSON.parse(val); return val; } catch { return JSON.stringify([val]); }
  }
  if (Array.isArray(val)) return JSON.stringify(val);
  return JSON.stringify(val);
}

function parseJson(val) {
  if (!val) return null;
  try { return JSON.parse(val); } catch { return null; }
}

function logMutation(db, observationId, type, oldVal, newVal, reason, sessionId) {
  db.prepare(`
    INSERT INTO observation_mutations (observation_id, mutation_type, old_value, new_value, reason, session_id, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    observationId, type,
    oldVal ? JSON.stringify(oldVal) : null,
    newVal ? JSON.stringify(newVal) : null,
    reason || null,
    sessionId || null,
    Date.now()
  );
}
