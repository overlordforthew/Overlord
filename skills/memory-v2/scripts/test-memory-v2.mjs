#!/usr/bin/env node

/**
 * Memory v2 — Comprehensive Test Suite
 * Run: node /root/overlord/skills/memory-v2/scripts/test-memory-v2.mjs
 */

import { getDb, closeDb } from '../lib/db.mjs';
import { initSchema } from '../lib/schema.mjs';
import * as events from '../lib/events.mjs';
import * as observations from '../lib/observations.mjs';
import { formatCompressionPrompt } from '../lib/compression.mjs';
import { buildSessionContext, detectProject } from '../lib/context.mjs';
import { execSync } from 'child_process';
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name) {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}`);
  }
}

function assertThrows(fn, name) {
  try {
    fn();
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name} (no error thrown)`);
  } catch {
    passed++;
    console.log(`  PASS  ${name}`);
  }
}

// We test against the LIVE db with unique session IDs, clean up after
const TEST_SESSION = `test-suite-${Date.now()}`;

async function main() {
  console.log('=== Memory v2 Test Suite ===\n');

  // ─── SCHEMA TESTS ───
  console.log('--- Schema ---');

  initSchema();
  const db = getDb();

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite%' AND name NOT LIKE 'observations_fts_%' ORDER BY name").all();
  const tableNames = tables.map(t => t.name);
  assert(tableNames.includes('tool_events'), 'tool_events table exists');
  assert(tableNames.includes('observations'), 'observations table exists');
  assert(tableNames.includes('observation_mutations'), 'observation_mutations table exists');
  assert(tableNames.includes('sessions'), 'sessions table exists');
  assert(tableNames.includes('observations_fts'), 'observations_fts virtual table exists');

  const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(t => t.name);
  assert(triggers.includes('obs_fts_insert'), 'FTS insert trigger exists');
  assert(triggers.includes('obs_fts_delete'), 'FTS delete trigger exists');
  assert(triggers.includes('obs_fts_update'), 'FTS update trigger exists');

  // Idempotent init
  initSchema();
  initSchema();
  assert(true, 'Schema init is idempotent (3x no error)');

  // ─── EVENTS TESTS ───
  console.log('\n--- Events ---');

  const eid1 = events.insertEvent({
    session_id: TEST_SESSION,
    project: 'TestProject',
    tool_name: 'Read',
    input_summary: '/root/projects/TestProject/src/index.ts',
    output_size: 1500
  });
  assert(typeof eid1 === 'number' || typeof eid1 === 'bigint', 'insertEvent returns id');

  const eid2 = events.insertEvent({
    session_id: TEST_SESSION,
    project: 'TestProject',
    tool_name: 'Edit',
    input_summary: '/root/projects/TestProject/src/app.ts'
  });
  assert(eid2 > eid1, 'Second event has higher id');

  const eid3 = events.insertEvent({
    session_id: TEST_SESSION,
    project: null,
    tool_name: 'Bash',
    input_summary: 'docker ps'
  });
  assert(eid3 > eid2, 'Event with null project inserts ok');

  const uncompCount = events.getUncompressedCount();
  assert(uncompCount >= 3, `Uncompressed count >= 3 (got ${uncompCount})`);

  const uncompEvents = events.getUncompressedEvents(1000);
  const testEvents = uncompEvents.filter(e => e.session_id === TEST_SESSION);
  assert(testEvents.length === 3, `3 test events found uncompressed (got ${testEvents.length})`);

  // Mark compressed
  events.markCompressed(Number(eid2));
  const afterMark = events.getUncompressedEvents(1000).filter(e => e.session_id === TEST_SESSION);
  const stillUncomp = afterMark.filter(e => Number(e.id) > Number(eid2));
  assert(afterMark.length >= 1, 'Some test events remain uncompressed after partial mark');

  // Session tracking
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(TEST_SESSION);
  assert(session !== undefined, 'Session record created');
  assert(session.project === 'TestProject' || session.project === null, 'Session has project');
  assert(session.tool_event_count >= 3, `Session event count >= 3 (got ${session.tool_event_count})`);

  // Event by session
  const sessionEvents = events.getEventsBySession(TEST_SESSION);
  assert(sessionEvents.length === 3, `getEventsBySession returns 3 (got ${sessionEvents.length})`);

  // ─── OBSERVATIONS TESTS ───
  console.log('\n--- Observations CRUD ---');

  const obsId1 = observations.store({
    session_id: TEST_SESSION,
    project: 'TestProject',
    type: 'bugfix',
    title: 'Fixed null pointer in auth handler',
    subtitle: 'Auth middleware crash',
    narrative: 'The auth handler crashed when token was undefined. Added null check.',
    facts: ['token was undefined', 'added null check before decode', 'crash affected login flow'],
    concepts: ['auth', 'null safety', 'middleware'],
    files_read: ['/src/middleware/auth.ts'],
    files_modified: ['/src/middleware/auth.ts'],
    outcome: 'worked',
    outcome_note: 'No more crashes in logs',
    source: 'test',
    tags: ['critical', 'auth'],
  });
  assert(typeof obsId1 === 'number' || typeof obsId1 === 'bigint', 'store returns observation id');

  const obs1 = observations.getById(Number(obsId1));
  assert(obs1 !== undefined, 'getById returns observation');
  assert(obs1.title === 'Fixed null pointer in auth handler', 'Title matches');
  assert(obs1.type === 'bugfix', 'Type matches');
  assert(obs1.project === 'TestProject', 'Project matches');
  assert(obs1.outcome === 'worked', 'Outcome matches');
  assert(obs1.status === 'active', 'Status is active');
  assert(obs1.depth === 0, 'Depth defaults to 0');
  assert(JSON.parse(obs1.facts).length === 3, 'Facts stored as JSON array (3 items)');
  assert(JSON.parse(obs1.concepts).length === 3, 'Concepts stored as JSON array');
  assert(JSON.parse(obs1.tags).length === 2, 'Tags stored as JSON array');
  assert(obs1.source === 'test', 'Source matches');
  assert(obs1.created_at > 0, 'created_at is set');
  assert(obs1.updated_at > 0, 'updated_at is set');

  // Store second observation
  const obsId2 = observations.store({
    session_id: TEST_SESSION,
    project: 'TestProject',
    type: 'discovery',
    title: 'TestProject uses Redis for session caching',
    narrative: 'Found Redis dependency during auth fix investigation.',
    facts: ['uses Redis 7', 'session TTL is 24h'],
    concepts: ['redis', 'caching', 'sessions'],
  });
  assert(obsId2 > obsId1, 'Second observation has higher id');

  // Store third for different project
  const obsId3 = observations.store({
    session_id: TEST_SESSION,
    project: 'OtherProject',
    type: 'feature',
    title: 'Added dark mode toggle to OtherProject',
    narrative: 'Implemented CSS variables approach for theming.',
    facts: ['uses CSS custom properties', 'toggle in navbar'],
    concepts: ['theming', 'css variables', 'dark mode'],
    outcome: 'worked',
  });

  // ─── SEARCH TESTS ───
  console.log('\n--- FTS5 Search ---');

  const r1 = observations.search('null pointer auth');
  assert(r1.length >= 1, 'Search "null pointer auth" finds result');
  assert(r1[0].id === Number(obsId1), 'Best match is the auth bugfix');

  const r2 = observations.search('Redis caching');
  assert(r2.length >= 1, 'Search "Redis caching" finds result');

  const r3 = observations.search('dark mode toggle');
  assert(r3.length >= 1, 'Search "dark mode toggle" finds result');

  // Project-scoped search
  const r4 = observations.search('auth', { project: 'TestProject' });
  assert(r4.length >= 1, 'Project-scoped search finds result');

  const r5 = observations.search('auth', { project: 'NonexistentProject' });
  assert(r5.length === 0, 'Project-scoped search returns empty for wrong project');

  // Partial match
  const r6 = observations.search('null');
  assert(r6.length >= 1, 'Partial search "null" finds result');

  // Multi-word
  const r7 = observations.search('CSS variables dark');
  assert(r7.length >= 1, 'Multi-word search works');

  // Access count incremented
  const afterSearch = observations.getById(Number(obsId1));
  assert(afterSearch.access_count >= 1, `Access count incremented (got ${afterSearch.access_count})`);

  // ─── UPDATE TESTS ───
  console.log('\n--- Update ---');

  const updated = observations.update(Number(obsId1), {
    outcome_note: 'Verified in production for 48 hours',
    importance: 0.9,
  }, { reason: 'Post-deploy verification' });
  assert(updated.outcome_note === 'Verified in production for 48 hours', 'outcome_note updated');

  // Verify importance (it's stored as real)
  const refetched = observations.getById(Number(obsId1));
  assert(refetched.importance === 0.9, 'importance updated to 0.9');
  assert(refetched.updated_at >= refetched.created_at, 'updated_at >= created_at');

  // Update facts (JSON field)
  observations.update(Number(obsId1), {
    facts: ['token was undefined', 'added null check', 'crash fixed', 'new fact added'],
  });
  const withNewFacts = observations.getById(Number(obsId1));
  assert(JSON.parse(withNewFacts.facts).length === 4, 'Facts updated to 4 items');

  // Update non-existent
  assertThrows(() => observations.update(999999, { title: 'nope' }), 'Update non-existent throws');

  // ─── RECENT TESTS ───
  console.log('\n--- Recent ---');

  const recent = observations.getRecent({ project: 'TestProject', limit: 5 });
  assert(recent.length >= 2, `Recent for TestProject >= 2 (got ${recent.length})`);
  assert(recent[0].created_at >= recent[1].created_at, 'Recent ordered by created_at DESC');

  const recentAll = observations.getRecent({ limit: 100 });
  assert(recentAll.length >= 3, `Recent all >= 3 (got ${recentAll.length})`);

  const recentByType = observations.getRecent({ type: 'bugfix' });
  assert(recentByType.every(o => o.type === 'bugfix'), 'Type filter works');

  // ─── SUPERSEDE TESTS ───
  console.log('\n--- Supersede ---');

  observations.supersede(Number(obsId2), { reason: 'Replaced by better observation' });
  const superseded = observations.getById(Number(obsId2));
  assert(superseded.status === 'superseded', 'Status changed to superseded');

  // Superseded excluded from search
  const r8 = observations.search('Redis');
  assert(r8.every(o => o.id !== Number(obsId2)), 'Superseded excluded from search');

  // ─── ARCHIVE (DELETE) TESTS ───
  console.log('\n--- Archive/Delete ---');

  // Store a throwaway
  const obsId4 = observations.store({
    session_id: TEST_SESSION,
    project: 'TestProject',
    type: 'config',
    title: 'Temporary config observation to delete',
    facts: ['throwaway'],
  });

  observations.archive(Number(obsId4), { reason: 'Test cleanup' });
  const archived = observations.getById(Number(obsId4));
  assert(archived.status === 'archived', 'Status changed to archived');

  // Archived excluded from active recent
  const recentActive = observations.getRecent({ project: 'TestProject' });
  assert(recentActive.every(o => o.status === 'active'), 'Archived excluded from recent (active filter)');

  // Archive non-existent
  assertThrows(() => observations.archive(999999), 'Archive non-existent throws');

  // ─── MERGE TESTS ───
  console.log('\n--- Merge ---');

  const mergeA = observations.store({
    session_id: TEST_SESSION,
    project: 'MergeProject',
    type: 'discovery',
    title: 'Merge target A',
    narrative: 'First observation narrative',
    facts: ['fact-a1', 'fact-shared'],
    concepts: ['concept-a', 'concept-shared'],
  });

  const mergeB = observations.store({
    session_id: TEST_SESSION,
    project: 'MergeProject',
    type: 'discovery',
    title: 'Merge target B',
    narrative: 'Second observation narrative',
    facts: ['fact-b1', 'fact-shared'],
    concepts: ['concept-b', 'concept-shared'],
  });

  const winnerId = observations.merge(Number(mergeA), Number(mergeB));
  assert(winnerId === Number(mergeB), 'Newer observation wins merge');

  const winner = observations.getById(Number(mergeB));
  const winnerFacts = JSON.parse(winner.facts);
  assert(winnerFacts.includes('fact-a1'), 'Merged facts include from A');
  assert(winnerFacts.includes('fact-b1'), 'Merged facts include from B');
  assert(winnerFacts.includes('fact-shared'), 'Merged facts include shared');
  // Deduplication
  assert(winnerFacts.filter(f => f === 'fact-shared').length === 1, 'Shared facts deduplicated');

  const winnerConcepts = JSON.parse(winner.concepts);
  assert(winnerConcepts.includes('concept-a'), 'Merged concepts include from A');
  assert(winnerConcepts.includes('concept-b'), 'Merged concepts include from B');
  assert(winnerConcepts.filter(c => c === 'concept-shared').length === 1, 'Shared concepts deduplicated');

  const loser = observations.getById(Number(mergeA));
  assert(loser.status === 'merged', 'Loser status is merged');
  assert(loser.superseded_by === Number(mergeB), 'Loser points to winner');

  // Merge non-existent
  assertThrows(() => observations.merge(999998, 999999), 'Merge non-existent throws');

  // ─── MUTATION HISTORY TESTS ───
  console.log('\n--- Mutation History ---');

  const history1 = observations.getHistory(Number(obsId1));
  assert(history1.length >= 3, `Auth bugfix has >= 3 mutations (got ${history1.length})`);
  assert(history1[0].mutation_type === 'create', 'First mutation is create');
  assert(history1.some(m => m.mutation_type === 'update'), 'Has update mutation');
  assert(history1.some(m => m.reason === 'Post-deploy verification'), 'Reason recorded in mutation');

  const historyMerge = observations.getHistory(Number(mergeB));
  assert(historyMerge.some(m => m.mutation_type === 'merge'), 'Merge mutation recorded');

  // ─── STATS TESTS ───
  console.log('\n--- Stats ---');

  const stats = observations.getStats();
  assert(stats.totalObs >= 3, `Total active obs >= 3 (got ${stats.totalObs})`);
  assert(stats.totalEvents >= 3, `Total events >= 3 (got ${stats.totalEvents})`);
  assert(Array.isArray(stats.byType), 'byType is array');
  assert(stats.byType.length >= 1, 'At least 1 type grouping');
  assert(Array.isArray(stats.byProject), 'byProject is array');
  assert(Array.isArray(stats.recentSessions), 'recentSessions is array');

  const sessions = observations.getSessions(5);
  assert(sessions.length >= 1, 'At least 1 session');
  assert(sessions[0].id !== undefined, 'Session has id');

  // ─── COMPRESSION TESTS ───
  console.log('\n--- Compression ---');

  // Add enough uncompressed events to trigger
  for (let i = 0; i < 12; i++) {
    events.insertEvent({
      session_id: TEST_SESSION,
      project: 'TestProject',
      tool_name: ['Read', 'Edit', 'Bash', 'Grep'][i % 4],
      input_summary: `test-compress-event-${i}`,
    });
  }

  const compResult = formatCompressionPrompt({ threshold: 10 });
  assert(compResult !== null, 'Compression prompt generated (threshold met)');
  assert(compResult.prompt.includes('MEMORY SYSTEM'), 'Prompt contains MEMORY SYSTEM header');
  assert(compResult.prompt.includes('memory.mjs store'), 'Prompt contains store instruction');
  assert(compResult.prompt.includes('memory.mjs mark-compressed'), 'Prompt contains mark-compressed instruction');
  assert(compResult.lastEventId > 0, 'lastEventId is positive');
  assert(compResult.eventCount >= 10, `Event count >= 10 (got ${compResult.eventCount})`);

  // Under threshold
  events.markCompressed(Number(compResult.lastEventId));
  const compResult2 = formatCompressionPrompt({ threshold: 10 });
  assert(compResult2 === null, 'No compression when under threshold');

  // ─── CONTEXT INJECTION TESTS ───
  console.log('\n--- Context Injection ---');

  const ctx1 = buildSessionContext({ project: 'TestProject' });
  assert(ctx1 !== null, 'Context generated for TestProject');
  assert(ctx1.includes('MEMORY CONTEXT'), 'Context contains header');
  assert(ctx1.includes('TestProject'), 'Context mentions project');
  assert(ctx1.includes('memory search'), 'Context includes search hint');

  const ctx2 = buildSessionContext({ project: 'NonexistentProject' });
  // May have cross-project patterns
  if (ctx2) {
    assert(!ctx2.includes('Recent for NonexistentProject'), 'No recent for nonexistent project');
  } else {
    assert(true, 'Null context for project with no observations (ok)');
  }

  // ─── PROJECT DETECTION TESTS ───
  console.log('\n--- Project Detection ---');

  assert(detectProject('/root/projects/BeastMode/src/app.js') === 'BeastMode', 'Detects BeastMode');
  assert(detectProject('/root/projects/Lumina/index.ts') === 'Lumina', 'Detects Lumina');
  assert(detectProject('/root/overlord/index.js') === 'Overlord', 'Detects Overlord');
  assert(detectProject('/root/projects/SurfaBabe/deep/nested/file.js') === 'SurfaBabe', 'Detects nested project');
  assert(detectProject('/tmp/random/file.txt') === null, 'Returns null for non-project path');
  assert(detectProject(null) === null, 'Returns null for null');
  assert(detectProject('') === null, 'Returns null for empty string');

  // ─── HOOK SCRIPT TESTS (via subprocess) ───
  console.log('\n--- Hook Scripts (subprocess) ---');

  // PostToolUse
  const captureOut = execSync(
    `echo '{"tool_name":"Grep","tool_input":{"pattern":"TODO","path":"/root/projects/OnlyHulls/src"},"session_id":"${TEST_SESSION}"}' | node /root/overlord/skills/memory-v2/scripts/capture-event.mjs`,
    { encoding: 'utf8' }
  );
  assert(captureOut.trim() === '{}', 'capture-event returns {}');

  // Verify it was recorded
  const onlyHullsEvents = events.getEventsBySession(TEST_SESSION).filter(e => e.project === 'OnlyHulls');
  assert(onlyHullsEvents.length >= 1, 'OnlyHulls event captured via subprocess');

  // Malformed input
  const malformedOut = execSync(
    `echo 'not json at all' | node /root/overlord/skills/memory-v2/scripts/capture-event.mjs`,
    { encoding: 'utf8' }
  );
  assert(malformedOut.trim() === '{}', 'Malformed input returns {} (graceful)');

  // Empty input
  const emptyOut = execSync(
    `echo '{}' | node /root/overlord/skills/memory-v2/scripts/capture-event.mjs`,
    { encoding: 'utf8' }
  );
  assert(emptyOut.trim() === '{}', 'Empty object returns {} (graceful)');

  // Missing fields
  const partialOut = execSync(
    `echo '{"tool_name":"Read"}' | node /root/overlord/skills/memory-v2/scripts/capture-event.mjs`,
    { encoding: 'utf8' }
  );
  assert(partialOut.trim() === '{}', 'Missing session_id returns {} (graceful)');

  // inject-context
  const injectOut = execSync(
    `echo '{"session_id":"${TEST_SESSION}"}' | node /root/overlord/skills/memory-v2/scripts/inject-context.mjs`,
    { encoding: 'utf8' }
  );
  const injectParsed = JSON.parse(injectOut.trim());
  assert(injectParsed.systemMessage !== undefined || Object.keys(injectParsed).length === 0, 'inject-context returns valid JSON');

  // prompt-compress (we just marked everything compressed, so should be under threshold)
  const compressOut = execSync(
    `echo '{"session_id":"${TEST_SESSION}"}' | node /root/overlord/skills/memory-v2/scripts/prompt-compress.mjs`,
    { encoding: 'utf8' }
  );
  const compressParsed = JSON.parse(compressOut.trim());
  assert(typeof compressParsed === 'object', 'prompt-compress returns valid JSON');

  // ─── CLI TESTS (subprocess) ───
  console.log('\n--- CLI (subprocess) ---');

  const cliStore = execSync(
    `node /root/overlord/skills/memory-v2/scripts/memory.mjs store --type config --title "CLI test observation" --narrative "Testing CLI store" --facts '["cli-fact"]' --project CLITest`,
    { encoding: 'utf8' }
  );
  assert(cliStore.includes('Stored observation #'), 'CLI store works');
  const cliId = parseInt(cliStore.match(/#(\d+)/)[1]);

  const cliSearch = execSync(
    `node /root/overlord/skills/memory-v2/scripts/memory.mjs search "CLI test"`,
    { encoding: 'utf8' }
  );
  assert(cliSearch.includes('CLI test observation'), 'CLI search finds stored observation');

  const cliDetail = execSync(
    `node /root/overlord/skills/memory-v2/scripts/memory.mjs detail ${cliId}`,
    { encoding: 'utf8' }
  );
  assert(cliDetail.includes('CLI test observation'), 'CLI detail shows observation');
  assert(cliDetail.includes('config'), 'CLI detail shows type');

  const cliUpdate = execSync(
    `node /root/overlord/skills/memory-v2/scripts/memory.mjs update ${cliId} --outcome worked --reason "Verified"`,
    { encoding: 'utf8' }
  );
  assert(cliUpdate.includes('Updated'), 'CLI update works');

  const cliHistory = execSync(
    `node /root/overlord/skills/memory-v2/scripts/memory.mjs history ${cliId}`,
    { encoding: 'utf8' }
  );
  assert(cliHistory.includes('create'), 'CLI history shows create');
  assert(cliHistory.includes('update'), 'CLI history shows update');

  const cliStats = execSync(
    `node /root/overlord/skills/memory-v2/scripts/memory.mjs stats`,
    { encoding: 'utf8' }
  );
  assert(cliStats.includes('Active observations'), 'CLI stats works');

  const cliSessions = execSync(
    `node /root/overlord/skills/memory-v2/scripts/memory.mjs sessions`,
    { encoding: 'utf8' }
  );
  assert(cliSessions.includes(TEST_SESSION.slice(0, 12)), 'CLI sessions shows test session');

  const cliDelete = execSync(
    `node /root/overlord/skills/memory-v2/scripts/memory.mjs delete ${cliId} --reason "test cleanup"`,
    { encoding: 'utf8' }
  );
  assert(cliDelete.includes('Archived'), 'CLI delete works');

  // Help (no args)
  const cliHelp = execSync(
    `node /root/overlord/skills/memory-v2/scripts/memory.mjs`,
    { encoding: 'utf8' }
  );
  assert(cliHelp.includes('Memory v2 CLI'), 'CLI help output works');

  // ─── STRESS TEST ───
  console.log('\n--- Stress Test ---');

  const stressSession = `stress-${Date.now()}`;
  const stressStart = Date.now();

  for (let i = 0; i < 100; i++) {
    events.insertEvent({
      session_id: stressSession,
      project: `StressProject${i % 5}`,
      tool_name: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'][i % 6],
      input_summary: `stress-event-${i}-${'x'.repeat(Math.min(i * 2, 200))}`,
    });
  }
  const stressTime = Date.now() - stressStart;
  assert(stressTime < 5000, `100 events inserted in ${stressTime}ms (< 5000ms)`);

  const stressEvents = events.getEventsBySession(stressSession);
  assert(stressEvents.length === 100, `All 100 stress events captured (got ${stressEvents.length})`);

  // Rapid observations
  const obsStart = Date.now();
  for (let i = 0; i < 20; i++) {
    observations.store({
      session_id: stressSession,
      project: `StressProject${i % 5}`,
      type: ['bugfix', 'feature', 'discovery', 'config'][i % 4],
      title: `Stress observation ${i}`,
      narrative: `Narrative for stress test ${i}`,
      facts: [`fact-${i}-a`, `fact-${i}-b`],
      concepts: [`concept-${i}`],
    });
  }
  const obsTime = Date.now() - obsStart;
  assert(obsTime < 5000, `20 observations stored in ${obsTime}ms (< 5000ms)`);

  // Search after stress
  const stressSearch = observations.search('stress observation');
  assert(stressSearch.length >= 10, `Stress search returns >= 10 (got ${stressSearch.length})`);

  // ─── EDGE CASES ───
  console.log('\n--- Edge Cases ---');

  // Special characters in search
  try {
    const specialSearch = observations.search('auth OR "null pointer"');
    assert(true, 'FTS5 OR query does not crash');
  } catch {
    assert(false, 'FTS5 OR query does not crash');
  }

  // Very long input_summary
  const longId = events.insertEvent({
    session_id: TEST_SESSION,
    project: 'TestProject',
    tool_name: 'Read',
    input_summary: 'x'.repeat(10000),
  });
  assert(longId > 0, 'Very long input_summary accepted');

  // Unicode in observation
  const unicodeId = observations.store({
    session_id: TEST_SESSION,
    project: 'TestProject',
    type: 'discovery',
    title: 'Unicode test: emoji and CJK',
    narrative: 'Found some text in Japanese and with emojis',
    facts: ['contains unicode characters', 'works fine'],
    concepts: ['i18n', 'unicode'],
  });
  const unicodeObs = observations.getById(Number(unicodeId));
  assert(unicodeObs.title.includes('Unicode'), 'Unicode in title preserved');

  // Store with string facts (not array)
  const stringFactId = observations.store({
    session_id: TEST_SESSION,
    project: 'TestProject',
    type: 'config',
    title: 'String fact test',
    facts: 'single-string-fact',
  });
  const stringFactObs = observations.getById(Number(stringFactId));
  assert(stringFactObs.facts !== null, 'String fact stored (not null)');

  // Null/undefined fields
  const minimalId = observations.store({
    type: 'discovery',
    title: 'Minimal observation',
  });
  const minimal = observations.getById(Number(minimalId));
  assert(minimal.session_id === null, 'Null session_id ok');
  assert(minimal.project === null, 'Null project ok');
  assert(minimal.narrative === null, 'Null narrative ok');
  assert(minimal.facts === null, 'Null facts ok');

  // ─── CLEANUP TEST DATA ───
  console.log('\n--- Cleanup ---');

  // Archive all test observations
  const allTestObs = db.prepare("SELECT id FROM observations WHERE session_id = ? AND status = 'active'").all(TEST_SESSION);
  for (const o of allTestObs) {
    observations.archive(o.id, { reason: 'test cleanup' });
  }
  const allStressObs = db.prepare("SELECT id FROM observations WHERE session_id = ? AND status = 'active'").all(stressSession);
  for (const o of allStressObs) {
    observations.archive(o.id, { reason: 'test cleanup' });
  }
  // Clean up minimal obs too
  observations.archive(Number(minimalId), { reason: 'test cleanup' });

  assert(true, 'Test data cleaned up');

  // ─── RESULTS ───
  console.log('\n=============================');
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log(`  TOTAL:  ${passed + failed}`);
  console.log('=============================');

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f}`);
    }
  }

  closeDb();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test suite crashed:', err);
  closeDb();
  process.exit(2);
});
