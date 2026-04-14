import Database from "better-sqlite3";
const db = new Database("/app/data/memory-v2.db", { readonly: true });

// 1. Breakdown by type and status
const byType = db.prepare("SELECT type, status, COUNT(*) as cnt FROM observations GROUP BY type, status ORDER BY type, status").all();
console.log("=== Observations by type/status ===");
byType.forEach(r => console.log("  " + r.type + " [" + r.status + "]: " + r.cnt));

// 2. Episodic by contact
const eps = db.prepare("SELECT jid, COUNT(*) as cnt FROM observations WHERE type='episodic' AND status='active' GROUP BY jid ORDER BY cnt DESC").all();
console.log("\n=== Episodic by contact ===");
eps.forEach(r => console.log("  " + (r.jid || "(no jid)") + ": " + r.cnt));

// 3. Semantic categories — full dump
const sem = db.prepare("SELECT id, category, title, importance, access_count, last_accessed, status FROM observations WHERE type='semantic' ORDER BY category, title").all();
console.log("\n=== All semantic memories ===");
sem.forEach(r => console.log("  [" + r.id + "] " + r.status + " " + (r.category||"?") + ": " + r.title + " (imp:" + r.importance + " acc:" + r.access_count + ")"));

// 4. Procedural
const proc = db.prepare("SELECT id, title, importance, status FROM observations WHERE type='procedural' ORDER BY title").all();
console.log("\n=== Procedural memories ===");
proc.forEach(r => console.log("  [" + r.id + "] " + r.status + ": " + r.title + " (imp:" + r.importance + ")"));

// 5. Duplicates
const dupes = db.prepare("SELECT category, title, COUNT(*) as cnt FROM observations WHERE type='semantic' AND status='active' GROUP BY category, title HAVING cnt > 1").all();
console.log("\n=== Duplicate semantics ===");
if (dupes.length === 0) console.log("  None");
else dupes.forEach(r => console.log("  DUPE: " + r.category + "/" + r.title + " x" + r.cnt));

// 6. Empty content
const empty = db.prepare("SELECT COUNT(*) as cnt FROM observations WHERE status='active' AND (narrative IS NULL OR narrative = '') AND (facts IS NULL OR facts = '')").get();
console.log("\n=== Empty content (no narrative + no facts) ===");
console.log("  " + empty.cnt + " records");

// 7. Session observations
const sess = db.prepare("SELECT COUNT(*) as cnt, MIN(created_at) as oldest, MAX(created_at) as newest FROM observations WHERE type='session'").get();
console.log("\n=== Session observations ===");
console.log("  " + sess.cnt + " total | oldest: " + new Date(sess.oldest * 1000).toISOString().split("T")[0] + " | newest: " + new Date(sess.newest * 1000).toISOString().split("T")[0]);

// 8. MEMORY.md check
import { existsSync, statSync, readFileSync } from "fs";
console.log("\n=== MEMORY.md ===");
if (existsSync("/app/MEMORY.md")) {
  const s = statSync("/app/MEMORY.md");
  console.log("  Size: " + s.size + " bytes | Modified: " + s.mtime.toISOString());
} else {
  console.log("  DOES NOT EXIST in container");
}
if (existsSync("/app/data/MEMORY.md")) {
  const s = statSync("/app/data/MEMORY.md");
  console.log("  data/MEMORY.md: " + s.size + " bytes | Modified: " + s.mtime.toISOString());
} else {
  console.log("  data/MEMORY.md: not present");
}

// 9. Tool events health
const evtSummary = db.prepare("SELECT compressed, COUNT(*) as cnt FROM tool_events GROUP BY compressed").all();
console.log("\n=== Tool events ===");
evtSummary.forEach(r => console.log("  compressed=" + r.compressed + ": " + r.cnt));

// 10. Stale sessions (no activity in 7+ days)
const weekAgo = Math.floor(Date.now() / 1000) - 7 * 86400;
const stale = db.prepare("SELECT COUNT(*) as cnt FROM sessions WHERE last_activity < ?").get(weekAgo);
console.log("\n=== Stale sessions (>7 days) ===");
console.log("  " + stale.cnt + " of " + db.prepare("SELECT COUNT(*) as cnt FROM sessions").get().cnt + " total");

db.close();
