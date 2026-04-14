import Database from 'better-sqlite3';
import { dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

// Container uses /app/data, host uses /root/overlord/data — same volume mount
const DB_PATH = existsSync('/app/data') ? '/app/data/memory-v2.db' : '/root/overlord/data/memory-v2.db';

let db;

export function getDb() {
  if (!db) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

export function closeDb() {
  if (db) {
    db.close();
    db = undefined;
  }
}
