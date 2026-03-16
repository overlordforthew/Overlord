import { getDb } from './db.mjs';
import { initSchema } from './schema.mjs';

export function insertEvent({ session_id, project, tool_name, input_summary, output_size }) {
  initSchema();
  const db = getDb();
  const now = Date.now();

  const stmt = db.prepare(`
    INSERT INTO tool_events (session_id, project, tool_name, input_summary, output_size, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(session_id, project || null, tool_name, input_summary || null, output_size || null, now);

  // Upsert session
  db.prepare(`
    INSERT INTO sessions (id, project, started_at, last_activity, tool_event_count)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      last_activity = excluded.last_activity,
      tool_event_count = tool_event_count + 1,
      project = COALESCE(excluded.project, project)
  `).run(session_id, project || null, now, now);

  return result.lastInsertRowid;
}

export function getUncompressedEvents(limit = 100) {
  initSchema();
  const db = getDb();
  return db.prepare(`
    SELECT * FROM tool_events
    WHERE compressed = 0
    ORDER BY timestamp ASC
    LIMIT ?
  `).all(limit);
}

export function getUncompressedCount() {
  initSchema();
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as cnt FROM tool_events WHERE compressed = 0').get();
  return row.cnt;
}

export function markCompressed(throughId) {
  initSchema();
  const db = getDb();
  return db.prepare('UPDATE tool_events SET compressed = 1 WHERE id <= ? AND compressed = 0').run(throughId);
}

export function getEventsBySession(sessionId) {
  initSchema();
  const db = getDb();
  return db.prepare('SELECT * FROM tool_events WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);
}

/**
 * Delete compressed events older than `daysOld` days.
 * Returns number of rows deleted.
 */
export function purgeOldEvents(daysOld = 7) {
  initSchema();
  const db = getDb();
  const cutoff = Date.now() - daysOld * 24 * 3600 * 1000;
  const { changes } = db.prepare('DELETE FROM tool_events WHERE compressed = 1 AND timestamp < ?').run(cutoff);
  return changes;
}
