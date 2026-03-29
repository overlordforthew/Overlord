import { getRecent, search } from './observations.mjs';
import { initSchema } from './schema.mjs';
import { getDb } from './db.mjs';

/**
 * Build progressive disclosure context for session injection.
 * Returns formatted string for systemMessage, or null if nothing relevant.
 */
export function buildSessionContext({ project, limit = 10 } = {}) {
  const sections = [];

  try {
    initSchema();
    const db = getDb();

    // Standing orders — high-importance episodic memories (rules Gil has set)
    const standingOrders = db.prepare(`
      SELECT title, narrative FROM observations
      WHERE status = 'active' AND type = 'episodic' AND importance >= 0.8
      ORDER BY importance DESC, access_count DESC LIMIT 8
    `).all();

    if (standingOrders.length > 0) {
      sections.push('STANDING ORDERS:');
      for (const o of standingOrders) {
        sections.push(`  • ${(o.narrative || o.title).slice(0, 150)}`);
      }
      sections.push('');
    }

    // Recent episodic context — decisions, preferences, facts discovered recently
    const recentEpisodic = db.prepare(`
      SELECT title, narrative, tags, created_at FROM observations
      WHERE status = 'active' AND type = 'episodic' AND importance < 0.8
      ORDER BY created_at DESC LIMIT 6
    `).all();

    if (recentEpisodic.length > 0) {
      sections.push('RECENT CONTEXT:');
      for (const e of recentEpisodic) {
        const date = new Date(e.created_at).toISOString().slice(0, 10);
        const tags = e.tags ? JSON.parse(e.tags) : [];
        const tagStr = tags.length ? ` [${tags[0]}]` : '';
        sections.push(`  • ${(e.narrative || e.title).slice(0, 120)}${tagStr} (${date})`);
      }
      sections.push('');
    }
  } catch { /* episodic query failed — continue with project obs */ }

  // Recent observations for current project
  if (project) {
    const projectObs = getRecent({ project, limit });
    if (projectObs.length > 0) {
      sections.push(`CURRENT PROJECT (${project}):`);
      for (const o of projectObs) {
        const date = new Date(o.created_at).toISOString().slice(0, 10);
        const outcome = o.outcome ? ` [${o.outcome}]` : '';
        sections.push(`  #${o.id} ${o.title} (${o.type}, ${date})${outcome}`);
      }
      sections.push('');
    }
  }

  // Cross-project patterns that worked
  const worked = getRecent({ limit: 5, status: 'active' });
  const crossProject = worked.filter(o => o.project !== project && o.outcome === 'worked');
  if (crossProject.length > 0) {
    sections.push('PATTERNS THAT WORKED:');
    for (const o of crossProject.slice(0, 3)) {
      sections.push(`  #${o.id} [${o.project || 'general'}] ${o.title}`);
    }
    sections.push('');
  }

  if (sections.length === 0) return null;

  return `MEMORY CONTEXT:
${sections.join('\n')}
Use \`memory search <query>\` to drill into details. Use \`memory detail <id>\` for full observation.`;
}

/**
 * Detect project from a file path.
 */
export function detectProject(filePath) {
  if (!filePath) return null;
  const match = filePath.match(/\/root\/projects\/([^/]+)/);
  if (match) return match[1];
  if (filePath.startsWith('/root/overlord')) return 'Overlord';
  return null;
}
