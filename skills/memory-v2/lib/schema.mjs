import { getDb } from './db.mjs';

const SCHEMA_SQL = `
-- Raw tool events (cheap capture, no LLM involved)
CREATE TABLE IF NOT EXISTS tool_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project TEXT,
  tool_name TEXT NOT NULL,
  input_summary TEXT,
  output_size INTEGER,
  timestamp INTEGER NOT NULL,
  compressed INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_te_session ON tool_events(session_id);
CREATE INDEX IF NOT EXISTS idx_te_uncompressed ON tool_events(compressed, timestamp);

-- Unified observations table
CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT,
  project TEXT,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  subtitle TEXT,
  narrative TEXT,
  facts TEXT,
  concepts TEXT,
  files_read TEXT,
  files_modified TEXT,

  outcome TEXT,
  outcome_note TEXT,

  depth INTEGER DEFAULT 0,
  parent_id INTEGER REFERENCES observations(id),

  superseded_by INTEGER REFERENCES observations(id),
  status TEXT DEFAULT 'active',

  discovery_tokens INTEGER,
  compressed_tokens INTEGER,

  jid TEXT,
  category TEXT,
  importance REAL DEFAULT 0.5,
  confidence REAL DEFAULT 1.0,
  source TEXT DEFAULT 'hook',
  tags TEXT,
  access_count INTEGER DEFAULT 0,
  last_accessed INTEGER,
  metadata TEXT,

  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_obs_project ON observations(project, created_at);
CREATE INDEX IF NOT EXISTS idx_obs_type ON observations(type);
CREATE INDEX IF NOT EXISTS idx_obs_active ON observations(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_obs_depth ON observations(depth);
CREATE INDEX IF NOT EXISTS idx_obs_parent ON observations(parent_id);
CREATE INDEX IF NOT EXISTS idx_obs_jid ON observations(jid);
CREATE INDEX IF NOT EXISTS idx_obs_category ON observations(category);

-- CRUD audit log
CREATE TABLE IF NOT EXISTS observation_mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  observation_id INTEGER NOT NULL REFERENCES observations(id),
  mutation_type TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  session_id TEXT,
  timestamp INTEGER NOT NULL
);

-- Session metadata
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project TEXT,
  started_at INTEGER NOT NULL,
  last_activity INTEGER NOT NULL,
  tool_event_count INTEGER DEFAULT 0,
  observation_count INTEGER DEFAULT 0
);
`;

const FTS_SQL = `
CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
  title, subtitle, narrative, facts, concepts,
  content=observations, content_rowid=id
);
`;

const TRIGGER_SQL = `
CREATE TRIGGER IF NOT EXISTS obs_fts_insert AFTER INSERT ON observations BEGIN
  INSERT INTO observations_fts(rowid, title, subtitle, narrative, facts, concepts)
  VALUES (new.id, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
END;

CREATE TRIGGER IF NOT EXISTS obs_fts_delete AFTER DELETE ON observations BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, facts, concepts)
  VALUES ('delete', old.id, old.title, old.subtitle, old.narrative, old.facts, old.concepts);
END;

CREATE TRIGGER IF NOT EXISTS obs_fts_update AFTER UPDATE ON observations
  WHEN old.title != new.title OR old.subtitle != new.subtitle OR old.narrative != new.narrative
    OR old.facts != new.facts OR old.concepts != new.concepts
BEGIN
  INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, facts, concepts)
  VALUES ('delete', old.id, old.title, old.subtitle, old.narrative, old.facts, old.concepts);
  INSERT INTO observations_fts(rowid, title, subtitle, narrative, facts, concepts)
  VALUES (new.id, new.title, new.subtitle, new.narrative, new.facts, new.concepts);
END;
`;

let initialized = false;

export function initSchema() {
  if (initialized) return;
  const db = getDb();
  db.exec(SCHEMA_SQL);
  db.exec(FTS_SQL);

  // Drop and recreate triggers to pick up any definition changes
  db.exec('DROP TRIGGER IF EXISTS obs_fts_insert');
  db.exec('DROP TRIGGER IF EXISTS obs_fts_delete');
  db.exec('DROP TRIGGER IF EXISTS obs_fts_update');
  db.exec(TRIGGER_SQL);

  initialized = true;
}
