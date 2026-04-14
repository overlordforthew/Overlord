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
const LOG_PATH = join(KNOWLEDGE_DIR, 'log.md');
const RAW_DIR = join(KNOWLEDGE_DIR, 'raw');
const CATEGORIES = ['patterns', 'decisions', 'insights', 'projects', 'entities', 'concepts', 'comparisons'];

// ============================================================
// INIT
// ============================================================

export function ensureKnowledgeDirs() {
  for (const cat of [...CATEGORIES, 'raw']) {
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
// LOG
// ============================================================

/**
 * Append a timestamped entry to knowledge/log.md.
 * Format: ## [YYYY-MM-DD] action | title\ndetails
 */
export function appendLog(action, title, details = '') {
  const date = new Date().toISOString().split('T')[0];
  const entry = `\n## [${date}] ${action} | ${title}\n${details}\n`;
  try {
    let existing = '';
    try { existing = readFileSync(LOG_PATH, 'utf8'); } catch { /* new file */ }
    writeFileSync(LOG_PATH, existing.trimEnd() + '\n' + entry);
  } catch (err) {
    console.error('[Knowledge] Failed to append log:', err.message);
  }
}

// ============================================================
// RAW SOURCES
// ============================================================

/**
 * Save an immutable source document to knowledge/raw/.
 * Returns the path to the saved file.
 */
export function saveSource(name, content) {
  if (!existsSync(RAW_DIR)) mkdirSync(RAW_DIR, { recursive: true });
  // Sanitize filename
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').toLowerCase();
  const fileName = safeName.endsWith('.md') ? safeName : `${safeName}.md`;
  const filePath = join(RAW_DIR, fileName);
  writeFileSync(filePath, content);
  return filePath;
}

/** List all raw source files */
export function listSources() {
  if (!existsSync(RAW_DIR)) return [];
  return readdirSync(RAW_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const filePath = join(RAW_DIR, f);
      const stat = statSync(filePath);
      return { name: f.replace('.md', ''), path: filePath, size: stat.size, modified: stat.mtime };
    });
}

// ============================================================
// INGEST CONTEXT
// ============================================================

/**
 * Build context for the LLM to process a new source.
 * Returns INDEX.md + list of all existing pages so the LLM
 * knows what to create vs update.
 */
export function getIngestContext() {
  const index = getIndex();
  const files = listKnowledgeFiles();
  const sources = listSources();

  const pageList = files.map(f => `  - ${f.category}/${f.name}.md (${Math.round(f.size / 1024)}KB)`).join('\n');
  const sourceList = sources.length > 0
    ? sources.map(s => `  - raw/${s.name}.md (${Math.round(s.size / 1024)}KB, ${s.modified.toISOString().split('T')[0]})`).join('\n')
    : '  (none yet)';

  return `## Current Wiki State

### Index
${index}

### All Pages (${files.length} files)
${pageList}

### Raw Sources (${sources.length} files)
${sourceList}

### Wiki Categories
- patterns/ — recurring solutions, error→fix mappings
- decisions/ — architecture choices and rationale
- insights/ — generated analysis, cross-project patterns
- projects/ — per-project knowledge
- entities/ — people, services, tools, APIs (entity profiles)
- concepts/ — topics, methodologies, design patterns
- comparisons/ — filed analyses, comparisons, query answers

### Page Convention
Each wiki page should have YAML frontmatter:
\`\`\`yaml
---
title: Page Title
type: entity|concept|pattern|decision|insight|project|comparison
updated: ${new Date().toISOString().split('T')[0]}
sources: [raw/source-name.md]
links: [category/related-page.md]
---
\`\`\`
Use markdown links to cross-reference other wiki pages: [Page Title](../category/page-name.md)`;
}

// ============================================================
// CROSS-REFERENCES
// ============================================================

/**
 * Scan wiki for pages that mention a given term.
 * Returns array of { file, category, count } where the term appears.
 */
export function findMentions(term) {
  if (!term || term.length < 3) return [];
  const termLC = term.toLowerCase();
  const results = [];

  for (const file of listKnowledgeFiles()) {
    try {
      const content = readFileSync(file.path, 'utf8').toLowerCase();
      const count = (content.match(new RegExp(termLC.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      if (count > 0) {
        results.push({ file: file.name, category: file.category, path: file.path, count });
      }
    } catch { /* skip */ }
  }

  return results.sort((a, b) => b.count - a.count);
}

/**
 * Find pages with no inbound links from other pages.
 */
export function findOrphanPages() {
  const files = listKnowledgeFiles();
  const allContent = new Map();
  const linkedPages = new Set();

  // Read all pages and extract outbound links
  for (const file of files) {
    try {
      const content = readFileSync(file.path, 'utf8');
      allContent.set(file.path, content);
      // Match markdown links like [text](../category/page.md) or (category/page.md)
      const linkPattern = /\]\((?:\.\.\/)?(\w+\/[\w-]+\.md)\)/g;
      let match;
      while ((match = linkPattern.exec(content)) !== null) {
        linkedPages.add(match[1]);
      }
    } catch { /* skip */ }
  }

  // Find pages not linked to by any other page
  return files.filter(f => {
    const relPath = `${f.category}/${f.name}.md`;
    return !linkedPages.has(relPath);
  }).map(f => ({ file: f.name, category: f.category, path: f.path }));
}

// ============================================================
// LINT
// ============================================================

/**
 * Health-check the wiki. Returns structured report of issues.
 */
export function lintWiki() {
  const files = listKnowledgeFiles();
  const now = Date.now();
  const STALE_DAYS = 30;
  const STUB_WORDS = 100;

  const orphans = findOrphanPages();

  const stale = files.filter(f => {
    const age = (now - f.modified.getTime()) / (1000 * 60 * 60 * 24);
    return age > STALE_DAYS;
  }).map(f => ({
    file: f.name, category: f.category,
    daysSinceUpdate: Math.round((now - f.modified.getTime()) / (1000 * 60 * 60 * 24)),
  }));

  const stubs = [];
  const deadLinks = [];
  const allMentions = new Map(); // track entity/concept mention frequency

  for (const file of files) {
    try {
      const content = readFileSync(file.path, 'utf8');

      // Check for stubs (skip frontmatter in word count)
      const bodyContent = content.replace(/^---[\s\S]*?---\n*/m, '');
      const wordCount = bodyContent.split(/\s+/).filter(w => w).length;
      if (wordCount < STUB_WORDS) {
        stubs.push({ file: file.name, category: file.category, words: wordCount });
      }

      // Check for dead links
      const linkPattern = /\]\((?:\.\.\/)?(\w+\/[\w-]+\.md)\)/g;
      let match;
      while ((match = linkPattern.exec(content)) !== null) {
        const targetPath = join(KNOWLEDGE_DIR, match[1]);
        if (!existsSync(targetPath)) {
          deadLinks.push({ from: `${file.category}/${file.name}.md`, to: match[1] });
        }
      }
    } catch { /* skip */ }
  }

  // Check raw sources without wiki pages
  const sources = listSources();
  const uningested = [];
  for (const src of sources) {
    // Check if any wiki page references this source in frontmatter
    let referenced = false;
    for (const file of files) {
      try {
        const content = readFileSync(file.path, 'utf8');
        if (content.includes(`raw/${src.name}`) || content.includes(src.name)) {
          referenced = true;
          break;
        }
      } catch { /* skip */ }
    }
    if (!referenced) uningested.push(src.name);
  }

  return {
    total_pages: files.length,
    total_sources: sources.length,
    orphans,
    stale,
    stubs,
    deadLinks,
    uningested,
    healthy: orphans.length === 0 && stale.length === 0 && deadLinks.length === 0 && stubs.length === 0,
  };
}

// ============================================================
// FILE ANSWER
// ============================================================

/**
 * File a good query answer back into the wiki as a new page.
 * Wraps writeKnowledge with frontmatter, log entry, and index regen.
 */
export function fileAnswer(title, content, category = 'comparisons', sources = []) {
  const topic = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const date = new Date().toISOString().split('T')[0];

  const frontmatter = `---
title: ${title}
type: ${category === 'comparisons' ? 'comparison' : category.replace(/s$/, '')}
updated: ${date}
sources: [${sources.join(', ')}]
filed_from: query
---

`;

  const fullContent = frontmatter + content;
  const filePath = writeKnowledge(category, topic, fullContent);

  appendLog('query-filed', title, `Filed as ${category}/${topic}.md`);
  regenerateIndex();

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
    entities: 'Entities (people, services, tools, APIs)',
    concepts: 'Concepts (topics, methodologies, design patterns)',
    comparisons: 'Comparisons (filed analyses and query answers)',
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
        // Read first non-header, non-frontmatter line as description
        let desc = '';
        try {
          const content = readFileSync(f.path, 'utf8');
          const contentLines = content.split('\n');
          let inFrontmatter = false;
          const firstLine = contentLines.find(l => {
            if (l.trim() === '---') { inFrontmatter = !inFrontmatter; return false; }
            if (inFrontmatter) return false;
            return l.trim() && !l.startsWith('#');
          });
          if (firstLine) desc = ' — ' + firstLine.trim().substring(0, 80);
        } catch { /* skip */ }
        const relPath = `${cat}/${f.name}.md`;
        lines.push(`- [${f.name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}](${relPath})${desc}`);
      }
    }
    lines.push('');
  }

  // Add raw sources count
  const sources = listSources();
  if (sources.length > 0) {
    lines.push('## Raw Sources');
    lines.push(`${sources.length} immutable source documents in raw/. These are read-only — the wiki synthesizes from them.`);
    for (const s of sources) {
      lines.push(`- [${s.name}](raw/${s.name}.md) (${s.modified.toISOString().split('T')[0]})`);
    }
    lines.push('');
  }

  lines.push('## Wiki Operations');
  lines.push('- **Ingest:** Drop a source into raw/, then process it — create/update entity, concept, and topic pages. Touch 10-15 pages per source.');
  lines.push('- **Query:** Search the wiki, synthesize answers. File good answers back as comparisons/ pages.');
  lines.push('- **Lint:** Health-check for orphans, stale pages, dead links, stubs, uningested sources.');
  lines.push('- **Write-back:** After solving problems, update relevant pages. Cross-reference with markdown links.');
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
