import { getRecent, search } from './observations.mjs';

/**
 * Build progressive disclosure context for session injection.
 * Returns formatted string for systemMessage, or null if nothing relevant.
 */
export function buildSessionContext({ project, limit = 10 } = {}) {
  const sections = [];

  // Recent observations for current project
  if (project) {
    const projectObs = getRecent({ project, limit });
    if (projectObs.length > 0) {
      sections.push(`Recent for ${project}:`);
      for (const o of projectObs) {
        const date = new Date(o.created_at).toISOString().slice(0, 10);
        const outcome = o.outcome ? ` [${o.outcome}]` : '';
        sections.push(`  #${o.id} ${o.title} (${o.type}, ${date})${outcome}`);
      }
    }
  }

  // Cross-project patterns that worked
  const worked = getRecent({ limit: 5, status: 'active' });
  const crossProject = worked.filter(o => o.project !== project && o.outcome === 'worked');
  if (crossProject.length > 0) {
    sections.push('');
    sections.push('Cross-project patterns (worked):');
    for (const o of crossProject.slice(0, 3)) {
      sections.push(`  #${o.id} [${o.project || 'general'}] ${o.title}`);
    }
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
