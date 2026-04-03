/**
 * Knowledge Engine — Compounding knowledge system for Overlord
 *
 * No RAG, no embeddings. Just structured markdown files, an index,
 * and an LLM that reads the right files at the right time.
 *
 * The knowledge directory (/root/overlord/knowledge/) stores:
 *   patterns/   — recurring solutions and error→fix mappings
 *   decisions/  — architecture choices and rationale
 *   insights/   — generated analysis and cross-project patterns
 *   projects/   — per-project knowledge
 *
 * INDEX.md is the master index — always loaded into admin context.
 * The bot writes back after significant conversations.
 * Weekly synthesis generates new insights automatically.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, basename, relative } from 'path';

const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR || './knowledge';
const INDEX_PATH = join(KNOWLEDGE_DIR, 'INDEX.md');
const CATEGORIES = ['patterns', 'decisions', 'insights', 'projects'];

// ============================================================
// INIT
// ============================================================

export function ensureKnowledgeDirs() {
  for (const cat of CATEGORIES) {
    const dir = join(KNOWLEDGE_DIR, cat);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(INDEX_PATH)) {
    writeFileSync(INDEX_PATH, '# Knowledge Base — Overlord\n\nNo knowledge files yet. The system will populate this automatically.\n');
  }
}

// ============================================================
// READ
// ============================================================

/** Get INDEX.md content for prompt injection */
export function getIndex() {
  try {
    return readFileSync(INDEX_PATH, 'utf8');
  } catch {
    return '';
  }
}

/** List all knowledge files with metadata */
export function listKnowledgeFiles() {
  const files = [];
  for (const cat of CATEGORIES) {
    const dir = join(KNOWLEDGE_DIR, cat);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.md')) continue;
      const filePath = join(dir, file);
      const stat = statSync(filePath);
      files.push({
        path: filePath,
        category: cat,
        name: file.replace('.md', ''),
        size: stat.size,
        modified: stat.mtime,
      });
    }
  }
  return files;
}

/** Read a specific knowledge file */
export function readKnowledgeFile(category, topic) {
  const filePath = join(KNOWLEDGE_DIR, category, `${topic}.md`);
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
}

// ============================================================
// SEARCH
// ============================================================

/**
 * Search knowledge files for content matching a query.
 * Simple keyword matching — no embeddings needed.
 * Returns array of { file, category, relevance, snippet }
 */
export function searchKnowledge(query, { limit = 5 } = {}) {
  if (!query || query.length < 3) return [];

  const keywords = query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (keywords.length === 0) return [];

  const results = [];
  const files = listKnowledgeFiles();

  for (const file of files) {
    try {
      const content = readFileSync(file.path, 'utf8').toLowerCase();
      let score = 0;
      const matchedKeywords = [];

      for (const kw of keywords) {
        const count = (content.match(new RegExp(kw, 'g')) || []).length;
        if (count > 0) {
          score += count;
          matchedKeywords.push(kw);
        }
      }

      // Bonus for matching in file name
      const nameLC = file.name.toLowerCase();
      for (const kw of keywords) {
        if (nameLC.includes(kw)) score += 5;
      }

      if (score > 0 && matchedKeywords.length >= Math.min(2, keywords.length)) {
        // Extract best snippet (first paragraph containing a matched keyword)
        const lines = readFileSync(file.path, 'utf8').split('\n');
        let snippet = '';
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].toLowerCase();
          if (matchedKeywords.some(kw => line.includes(kw)) && !lines[i].startsWith('#')) {
            // Grab this line + 2 surrounding for context
            snippet = lines.slice(Math.max(0, i - 1), i + 3).join('\n').trim();
            break;
          }
        }

        results.push({
          file: file.name,
          category: file.category,
          path: file.path,
          relevance: score,
          matchedKeywords,
          snippet: snippet.substring(0, 300),
        });
      }
    } catch { /* skip unreadable files */ }
  }

  return results.sort((a, b) => b.relevance - a.relevance).slice(0, limit);
}

// ============================================================
// PROMPT INJECTION
// ============================================================

/**
 * Get formatted knowledge context for prompt injection.
 * Searches knowledge files for relevant content and formats it.
 * Keeps output under maxTokens to avoid prompt bloat.
 */
export function getKnowledgeContext(query, { maxChars = 2000 } = {}) {
  const results = searchKnowledge(query, { limit: 3 });
  if (results.length === 0) return '';

  const sections = [];
  let totalChars = 0;

  for (const result of results) {
    if (totalChars > maxChars) break;
    const entry = `[${result.category}/${result.file}] ${result.snippet}`;
    sections.push(entry);
    totalChars += entry.length;
  }

  return sections.join('\n\n');
}

/**
 * Get the INDEX.md as a compact prompt section.
 * This gives the bot a map of what knowledge exists.
 */
export function getKnowledgeMap() {
  const index = getIndex();
  if (!index) return '';

  // Extract just the file listing lines (lines with links)
  const lines = index.split('\n')
    .filter(l => l.includes('](') || l.startsWith('#') || l.startsWith('**'))
    .join('\n');

  return lines || index.substring(0, 1500);
}

// ============================================================
// WRITE
// ============================================================

/**
 * Write or update a knowledge file.
 * Creates the file if it doesn't exist, appends or replaces content.
 */
export function writeKnowledge(category, topic, content) {
  if (!CATEGORIES.includes(category)) {
    throw new Error(`Invalid category: ${category}. Must be one of: ${CATEGORIES.join(', ')}`);
  }

  const dir = join(KNOWLEDGE_DIR, category);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const filePath = join(dir, `${topic}.md`);
  writeFileSync(filePath, content);
  return filePath;
}

/**
 * Append a section to an existing knowledge file.
 * Creates the file with a header if it doesn't exist.
 */
export function appendKnowledge(category, topic, section) {
  const filePath = join(KNOWLEDGE_DIR, category, `${topic}.md`);
  let existing = '';
  try {
    existing = readFileSync(filePath, 'utf8');
  } catch {
    existing = `# ${topic.charAt(0).toUpperCase() + topic.slice(1).replace(/-/g, ' ')}\n\n`;
  }

  writeFileSync(filePath, existing.trimEnd() + '\n\n' + section.trim() + '\n');
  return filePath;
}

// ============================================================
// INDEX REGENERATION
// ============================================================

/**
 * Regenerate INDEX.md from all knowledge files.
 * Preserves the header and structure, updates file listings.
 */
export function regenerateIndex() {
  const files = listKnowledgeFiles();
  const byCategory = {};
  for (const f of files) {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  }

  const categoryLabels = {
    patterns: 'Patterns (recurring solutions)',
    decisions: 'Decisions (why things are the way they are)',
    insights: 'Insights (generated analysis)',
    projects: 'Projects (per-project knowledge)',
  };

  const lines = [
    '# Knowledge Base — Overlord',
    '',
    'Master index for Overlord\'s compounding knowledge system. This file is injected into every admin conversation so the bot knows what it knows and where to find it.',
    '',
    `**How this works:** Overlord reads files, solves problems, and writes back what it learned. Every session compounds into the next.`,
    '',
    `**Stats:** ${files.length} knowledge files across ${Object.keys(byCategory).length} categories. Last updated: ${new Date().toISOString().split('T')[0]}.`,
    '',
  ];

  for (const cat of CATEGORIES) {
    const catFiles = byCategory[cat] || [];
    lines.push(`## ${categoryLabels[cat] || cat}`);
    if (catFiles.length === 0) {
      lines.push('- (no files yet)');
    } else {
      for (const f of catFiles.sort((a, b) => a.name.localeCompare(b.name))) {
        // Read first non-header line as description
        let desc = '';
        try {
          const content = readFileSync(f.path, 'utf8');
          const firstLine = content.split('\n').find(l => l.trim() && !l.startsWith('#'));
          if (firstLine) desc = ' — ' + firstLine.trim().substring(0, 80);
        } catch { /* skip */ }
        const relPath = `${cat}/${f.name}.md`;
        lines.push(`- [${f.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}](${relPath})${desc}`);
      }
    }
    lines.push('');
  }

  lines.push('## How to Use This');
  lines.push('- **Reading:** Search by keyword or browse by category. INDEX.md tells you where to look.');
  lines.push('- **Writing back:** After solving a problem, discovering a pattern, or making a decision — update the relevant file or create a new one. Always regenerate INDEX.md after adding files.');
  lines.push('- **Synthesis:** Weekly automated synthesis reviews recent conversations and generates insights.');

  const content = lines.join('\n');
  writeFileSync(INDEX_PATH, content);
  return { files: files.length, categories: Object.keys(byCategory).length };
}

// ============================================================
// SYNTHESIS PROMPT
// ============================================================

/**
 * Generate the synthesis prompt for the weekly knowledge synthesis task.
 * This is passed to Claude CLI via executor.js.
 */
export function getSynthesisPrompt() {
  const files = listKnowledgeFiles();
  const fileList = files.map(f => `  - ${f.category}/${f.name}.md (${Math.round(f.size / 1024)}KB, updated ${f.modified.toISOString().split('T')[0]})`).join('\n');

  return `You are running the weekly knowledge synthesis for Overlord's compounding knowledge system.

KNOWLEDGE DIRECTORY: /root/overlord/knowledge/
Current files:
${fileList}

YOUR TASK:
1. Read the existing knowledge files to understand what's already documented.
2. Review recent conversations: query the database for the last 7 days of admin conversations.
   SQL: SELECT user_message, assistant_response, model_id, created_at FROM conversations WHERE sender_name = 'Gil Barden' AND created_at > NOW() - INTERVAL '7 days' ORDER BY created_at DESC LIMIT 50;
3. Identify NEW patterns, decisions, or insights not yet captured in knowledge files.
4. Update existing files or create new ones with what you learned.
5. Update insights/synthesis-latest.md with a summary of this synthesis cycle.
6. Run: node -e "import { regenerateIndex } from './knowledge-engine.js'; console.log(JSON.stringify(regenerateIndex()));"
   to regenerate INDEX.md.

RULES:
- Only write knowledge that has lasting value. Skip ephemeral conversations.
- Be specific: "Docker restart after timezone change breaks Baileys auth" > "Docker can have issues"
- Update existing files rather than creating duplicates.
- If a pattern appears in multiple projects, add it to insights/cross-project.md.
- Keep each file focused on one topic.`;
}

// Init on import
ensureKnowledgeDirs();
console.log(`[Knowledge] Engine loaded — ${listKnowledgeFiles().length} knowledge files indexed`);
