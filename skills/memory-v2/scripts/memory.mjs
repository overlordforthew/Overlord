#!/usr/bin/env node

/**
 * Memory v2 CLI entry point.
 *
 * Usage:
 *   memory init
 *   memory search <query> [--project P]
 *   memory detail <id>
 *   memory store --type T --title "..." [--narrative "..."] [--facts '[...]'] [--concepts '[...]']
 *                 [--files-read '[...]'] [--files-modified '[...]'] [--outcome worked|failed|partial]
 *                 [--project P] [--session-id S] [--source S] [--tags '[...]']
 *   memory mark-compressed --through-id N
 *   memory update <id> [--field value ...]
 *   memory supersede <id> --reason "..."
 *   memory delete <id> --reason "..."
 *   memory merge <id1> <id2>
 *   memory history <id>
 *   memory stats
 *   memory sessions
 *   memory compress
 */

import { initSchema } from '../lib/schema.mjs';
import * as observations from '../lib/observations.mjs';
import * as events from '../lib/events.mjs';
import { formatCompressionPrompt } from '../lib/compression.mjs';
import { closeDb } from '../lib/db.mjs';

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function parseJsonArg(val) {
  if (!val) return undefined;
  try { return JSON.parse(val); } catch { return val; }
}

function formatDate(ts) {
  if (!ts) return 'N/A';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

function formatObservation(o, compact = false) {
  if (compact) {
    const date = formatDate(o.created_at).slice(0, 10);
    const outcome = o.outcome ? ` [${o.outcome}]` : '';
    return `#${o.id} ${o.title} (${o.type}, ${date})${outcome}${o.project ? ' [' + o.project + ']' : ''}`;
  }

  const lines = [
    `--- Observation #${o.id} ---`,
    `Type:     ${o.type}`,
    `Title:    ${o.title}`,
  ];
  if (o.subtitle) lines.push(`Subtitle: ${o.subtitle}`);
  if (o.project) lines.push(`Project:  ${o.project}`);
  if (o.narrative) lines.push(`Narrative: ${o.narrative}`);
  if (o.facts) lines.push(`Facts:    ${o.facts}`);
  if (o.concepts) lines.push(`Concepts: ${o.concepts}`);
  if (o.files_read) lines.push(`Read:     ${o.files_read}`);
  if (o.files_modified) lines.push(`Modified: ${o.files_modified}`);
  if (o.outcome) lines.push(`Outcome:  ${o.outcome}${o.outcome_note ? ' — ' + o.outcome_note : ''}`);
  lines.push(`Status:   ${o.status}`);
  lines.push(`Depth:    ${o.depth}`);
  lines.push(`Source:   ${o.source}`);
  if (o.tags) lines.push(`Tags:     ${o.tags}`);
  lines.push(`Created:  ${formatDate(o.created_at)}`);
  if (o.updated_at) lines.push(`Updated:  ${formatDate(o.updated_at)}`);
  lines.push(`Accessed: ${o.access_count} times`);
  if (o.session_id) lines.push(`Session:  ${o.session_id}`);
  return lines.join('\n');
}

try {
  switch (command) {
    case 'init': {
      initSchema();
      console.log('Memory v2 database initialized.');
      break;
    }

    case 'search': {
      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      const project = getFlag('project');
      if (!query) { console.error('Usage: memory search <query> [--project P]'); process.exit(1); }
      const results = observations.search(query, { project });
      if (results.length === 0) {
        console.log('No results found.');
      } else {
        console.log(`Found ${results.length} result(s):\n`);
        for (const r of results) {
          console.log(formatObservation(r, true));
        }
      }
      break;
    }

    case 'detail': {
      const id = parseInt(args[1]);
      if (!id) { console.error('Usage: memory detail <id>'); process.exit(1); }
      const obs = observations.getById(id);
      if (!obs) { console.error(`Observation #${id} not found.`); process.exit(1); }
      console.log(formatObservation(obs));
      break;
    }

    case 'store': {
      const type = getFlag('type');
      const title = getFlag('title');
      if (!type || !title) {
        console.error('Usage: memory store --type T --title "..." [--narrative "..."] [--facts \'[...]\'] ...');
        process.exit(1);
      }

      const id = observations.store({
        type,
        title,
        subtitle: getFlag('subtitle'),
        narrative: getFlag('narrative'),
        facts: parseJsonArg(getFlag('facts')),
        concepts: parseJsonArg(getFlag('concepts')),
        files_read: parseJsonArg(getFlag('files-read')),
        files_modified: parseJsonArg(getFlag('files-modified')),
        outcome: getFlag('outcome'),
        outcome_note: getFlag('outcome-note'),
        project: getFlag('project'),
        session_id: getFlag('session-id'),
        source: getFlag('source') || 'manual',
        tags: parseJsonArg(getFlag('tags')),
      });

      console.log(`Stored observation #${id}`);
      break;
    }

    case 'mark-compressed': {
      const throughId = parseInt(getFlag('through-id'));
      if (!throughId) { console.error('Usage: memory mark-compressed --through-id N'); process.exit(1); }
      const result = events.markCompressed(throughId);
      console.log(`Marked ${result.changes} events as compressed.`);
      break;
    }

    case 'update': {
      const id = parseInt(args[1]);
      if (!id) { console.error('Usage: memory update <id> --field value ...'); process.exit(1); }

      const fields = {};
      const updateableFields = [
        'title', 'subtitle', 'narrative', 'facts', 'concepts',
        'files-read', 'files-modified', 'outcome', 'outcome-note',
        'type', 'project', 'importance', 'confidence', 'tags',
        'category', 'status'
      ];

      for (const f of updateableFields) {
        const val = getFlag(f);
        if (val !== undefined) {
          const key = f.replace(/-/g, '_');
          fields[key] = ['facts', 'concepts', 'files_read', 'files_modified', 'tags'].includes(key)
            ? parseJsonArg(val) : val;
        }
      }

      const reason = getFlag('reason');
      const updated = observations.update(id, fields, { reason });
      console.log(`Updated observation #${id}`);
      break;
    }

    case 'supersede': {
      const id = parseInt(args[1]);
      const reason = getFlag('reason');
      if (!id) { console.error('Usage: memory supersede <id> --reason "..."'); process.exit(1); }
      observations.supersede(id, { reason });
      console.log(`Superseded observation #${id}`);
      break;
    }

    case 'delete': {
      const id = parseInt(args[1]);
      const reason = getFlag('reason');
      if (!id) { console.error('Usage: memory delete <id> --reason "..."'); process.exit(1); }
      observations.archive(id, { reason });
      console.log(`Archived observation #${id}`);
      break;
    }

    case 'merge': {
      const id1 = parseInt(args[1]);
      const id2 = parseInt(args[2]);
      if (!id1 || !id2) { console.error('Usage: memory merge <id1> <id2>'); process.exit(1); }
      const winnerId = observations.merge(id1, id2);
      console.log(`Merged into observation #${winnerId}`);
      break;
    }

    case 'history': {
      const id = parseInt(args[1]);
      if (!id) { console.error('Usage: memory history <id>'); process.exit(1); }
      const history = observations.getHistory(id);
      if (history.length === 0) {
        console.log('No mutations recorded.');
      } else {
        for (const m of history) {
          console.log(`${formatDate(m.timestamp)} ${m.mutation_type}${m.reason ? ' — ' + m.reason : ''}`);
        }
      }
      break;
    }

    case 'stats': {
      const s = observations.getStats();
      console.log('=== Memory v2 Stats ===');
      console.log(`Active observations: ${s.totalObs}`);
      console.log(`Total tool events:   ${s.totalEvents}`);
      console.log(`Uncompressed events: ${s.uncompressed}`);
      if (s.byType.length) {
        console.log('\nBy type:');
        for (const t of s.byType) console.log(`  ${t.type}: ${t.cnt}`);
      }
      if (s.byProject.length) {
        console.log('\nBy project:');
        for (const p of s.byProject) console.log(`  ${p.project}: ${p.cnt}`);
      }
      if (s.recentSessions.length) {
        console.log('\nRecent sessions:');
        for (const sess of s.recentSessions) {
          console.log(`  ${sess.id.slice(0, 12)}... [${sess.project || 'unknown'}] ${sess.tool_event_count} events, ${sess.observation_count} obs, last ${formatDate(sess.last_activity)}`);
        }
      }
      break;
    }

    case 'sessions': {
      const sessions = observations.getSessions(parseInt(args[1]) || 10);
      if (sessions.length === 0) {
        console.log('No sessions recorded.');
      } else {
        for (const s of sessions) {
          console.log(`${s.id.slice(0, 16)}... [${s.project || '?'}] ${s.tool_event_count} events, ${s.observation_count} obs, ${formatDate(s.started_at)} - ${formatDate(s.last_activity)}`);
        }
      }
      break;
    }

    case 'compress': {
      const result = formatCompressionPrompt({ threshold: 1 });
      if (!result) {
        console.log('No pending events to compress.');
      } else {
        console.log(result.prompt);
      }
      break;
    }

    default:
      console.log(`Memory v2 CLI

Commands:
  memory init                              Initialize database
  memory search <query> [--project P]      Search observations (FTS5)
  memory detail <id>                       Show full observation
  memory store --type T --title "..."      Store new observation
  memory mark-compressed --through-id N    Mark events as compressed
  memory update <id> --field value         Update observation fields
  memory supersede <id> --reason "..."     Mark as superseded
  memory delete <id> --reason "..."        Soft-delete (archive)
  memory merge <id1> <id2>                 Combine two observations
  memory history <id>                      Show mutation audit log
  memory stats                             Dashboard
  memory sessions                          List recent sessions
  memory compress                          Manual compression trigger`);
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
} finally {
  closeDb();
}
