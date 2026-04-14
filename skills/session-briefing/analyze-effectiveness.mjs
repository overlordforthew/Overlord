#!/usr/bin/env node

/**
 * Analyze session briefing effectiveness.
 * Reads injection logs + session transcripts to determine which briefing
 * sections actually influenced sessions vs. wasted tokens.
 *
 * Usage:
 *   node analyze-effectiveness.mjs              # Analyze last 20 sessions
 *   node analyze-effectiveness.mjs --all        # Analyze all logged sessions
 *   node analyze-effectiveness.mjs --json       # Machine-readable output
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const INJECTION_LOG = '/root/overlord/data/briefing-injections.jsonl';
const TRANSCRIPT_DIRS = [
  '/root/.claude/projects/-root',
  '/root/.claude/projects/-root-overlord',
  '/root/.claude/projects/-root-projects',
];

// ------- Load injection records -------

function loadInjections(limit) {
  if (!existsSync(INJECTION_LOG)) {
    console.error('No injection log found. Sessions need to run first.');
    process.exit(1);
  }
  const lines = readFileSync(INJECTION_LOG, 'utf8').trim().split('\n').filter(Boolean);
  const records = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  return limit ? records.slice(-limit) : records;
}

// ------- Find transcript for a session -------

function findTranscript(sessionId) {
  if (!sessionId) return null;

  for (const dir of TRANSCRIPT_DIRS) {
    if (!existsSync(dir)) continue;
    const candidate = join(dir, `${sessionId}.jsonl`);
    if (existsSync(candidate)) return candidate;
  }

  // Fallback: scan all .jsonl files for matching sessionId
  for (const dir of TRANSCRIPT_DIRS) {
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
      for (const f of files) {
        const path = join(dir, f);
        // Check first line for sessionId match
        const firstLine = readFileSync(path, 'utf8').split('\n')[0];
        try {
          const parsed = JSON.parse(firstLine);
          if (parsed.sessionId === sessionId) return path;
        } catch { continue; }
      }
    } catch { continue; }
  }

  return null;
}

// ------- Analyze a single session -------

function analyzeSession(injection) {
  const result = {
    session_id: injection.session_id,
    at: injection.at,
    project: injection.project,
    token_estimate: injection.token_estimate,
    briefing_age_min: injection.briefing_age_min,
    fallback: injection.fallback,
    sections_injected: injection.sections,
    usage: {
      greeting_delivered: false,
      server_referenced: false,
      issues_acted_on: false,
      git_referenced: false,
      repairs_referenced: false,
      memory_used: false,
      projects_worked: [],
    },
    transcript_found: false,
    session_duration_min: null,
    user_messages: 0,
    assistant_messages: 0,
    tools_used: [],
  };

  const transcriptPath = findTranscript(injection.session_id);
  if (!transcriptPath) return result;

  result.transcript_found = true;

  let lines;
  try {
    lines = readFileSync(transcriptPath, 'utf8').trim().split('\n').filter(Boolean);
  } catch { return result; }

  const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  if (events.length === 0) return result;

  // Session duration
  const timestamps = events.filter(e => e.timestamp).map(e => new Date(e.timestamp).getTime());
  if (timestamps.length >= 2) {
    result.session_duration_min = Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 60000);
  }

  // Track tools and messages
  const toolSet = new Set();
  const projectSet = new Set();
  let firstAssistantText = '';

  for (const evt of events) {
    if (!evt.message) continue;

    if (evt.message.role === 'user') {
      result.user_messages++;
    }

    if (evt.message.role === 'assistant') {
      result.assistant_messages++;

      for (const block of (evt.message.content || [])) {
        // Track tool usage
        if (block.type === 'tool_use') {
          toolSet.add(block.name);

          // Track project from file paths in tool inputs
          const input = JSON.stringify(block.input || {});
          const projMatch = input.match(/\/root\/projects\/([^/"]+)/);
          if (projMatch) projectSet.add(projMatch[1]);
          if (input.includes('/root/overlord')) projectSet.add('Overlord');
        }

        // Capture first assistant text for greeting analysis
        if (block.type === 'text' && !firstAssistantText) {
          firstAssistantText = block.text;
        }
      }
    }
  }

  result.tools_used = [...toolSet];
  result.usage.projects_worked = [...projectSet];

  // --- Detect briefing section usage ---

  const allText = events
    .filter(e => e.message?.role === 'assistant')
    .flatMap(e => (e.message.content || []).filter(b => b.type === 'text').map(b => b.text))
    .join('\n')
    .toLowerCase();

  // Greeting check: did first response reference server/status/briefing keywords?
  const greetLower = firstAssistantText.toLowerCase();
  const greetKeywords = ['server', 'container', 'running', 'uptime', 'repair', 'commit', 'morning', 'afternoon', 'evening', 'briefing', 'status', 'healthy', 'all clear', 'all quiet'];
  result.usage.greeting_delivered = greetKeywords.some(k => greetLower.includes(k));

  // Server section: referenced uptime, memory, disk, containers
  const serverKeywords = ['uptime', 'ram', 'disk', 'container', 'memory usage', 'load average'];
  result.usage.server_referenced = serverKeywords.some(k => allText.includes(k));

  // Issues: referenced stopped containers or acted on them
  if (injection.sections.issues) {
    const issueKeywords = ['stopped', 'exited', 'restart', 'docker start', 'hl-blessings'];
    result.usage.issues_acted_on = issueKeywords.some(k => allText.includes(k));
  }

  // Git activity: referenced commits or worked on mentioned projects
  const gitProjects = injection.sections.git_activity || [];
  if (gitProjects.length > 0) {
    result.usage.git_referenced = gitProjects.some(p =>
      allText.includes(p.toLowerCase()) || projectSet.has(p)
    );
  }

  // Repairs: discussed auto-repair or related incidents
  if (injection.sections.repairs > 0) {
    const repairKeywords = ['repair', 'auto-fix', 'self-heal', 'incident', 'task-event'];
    result.usage.repairs_referenced = repairKeywords.some(k => allText.includes(k));
  }

  // Memory: used mem search/recall/context
  result.usage.memory_used = allText.includes('mem search') || allText.includes('mem recall') || allText.includes('mem context') || toolSet.has('Bash');

  return result;
}

// ------- Aggregate stats -------

function aggregate(analyses) {
  const total = analyses.length;
  const withTranscripts = analyses.filter(a => a.transcript_found);
  const t = withTranscripts.length;

  if (t === 0) {
    return {
      total_injections: total,
      transcripts_analyzed: 0,
      avg_token_estimate: Math.round(analyses.reduce((s, a) => s + (a.token_estimate || 0), 0) / total),
      avg_session_duration_min: 0,
      section_usage: null,
      recommendations: { high_value: 'Need more data', low_value: 'Need more data', min_sessions_for_confidence: 10 },
      message: 'No transcripts found to analyze yet. Sessions need to complete first.',
    };
  }

  const avgTokens = Math.round(analyses.reduce((s, a) => s + (a.token_estimate || 0), 0) / total);
  const avgDuration = Math.round(withTranscripts.filter(a => a.session_duration_min).reduce((s, a) => s + a.session_duration_min, 0) / t);

  const sectionUsage = {
    greeting_delivered: withTranscripts.filter(a => a.usage.greeting_delivered).length,
    server_referenced: withTranscripts.filter(a => a.usage.server_referenced).length,
    issues_acted_on: withTranscripts.filter(a => a.usage.issues_acted_on).length,
    git_referenced: withTranscripts.filter(a => a.usage.git_referenced).length,
    repairs_referenced: withTranscripts.filter(a => a.usage.repairs_referenced).length,
    memory_used: withTranscripts.filter(a => a.usage.memory_used).length,
  };

  // Calculate ROI: tokens spent vs. section usage rate
  const sectionROI = {};
  for (const [section, count] of Object.entries(sectionUsage)) {
    const rate = Math.round((count / t) * 100);
    sectionROI[section] = { used: count, total: t, rate: `${rate}%` };
  }

  // Token waste estimate: sections with <20% usage rate are likely wasteful
  const lowValueSections = Object.entries(sectionROI)
    .filter(([, v]) => parseInt(v.rate) < 20 && v.total >= 5)
    .map(([k]) => k);

  const highValueSections = Object.entries(sectionROI)
    .filter(([, v]) => parseInt(v.rate) >= 50)
    .map(([k]) => k);

  return {
    total_injections: total,
    transcripts_analyzed: t,
    avg_token_estimate: avgTokens,
    avg_session_duration_min: avgDuration,
    section_usage: sectionROI,
    recommendations: {
      high_value: highValueSections.length > 0
        ? `Keep: ${highValueSections.join(', ')} (>50% usage)`
        : 'Need more data',
      low_value: lowValueSections.length > 0
        ? `Consider trimming: ${lowValueSections.join(', ')} (<20% usage)`
        : 'No clear waste yet',
      min_sessions_for_confidence: Math.max(0, 10 - t),
    },
  };
}

// ------- Main -------

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const jsonOutput = args.includes('--json');
const limit = showAll ? null : 20;

const injections = loadInjections(limit);

if (injections.length === 0) {
  console.log('No briefing injections logged yet. Start a few Claude Code sessions first.');
  process.exit(0);
}

const analyses = injections.map(inj => analyzeSession(inj));
const stats = aggregate(analyses);

if (jsonOutput) {
  console.log(JSON.stringify({ stats, sessions: analyses }, null, 2));
} else {
  console.log('=== SESSION BRIEFING EFFECTIVENESS ===\n');
  console.log(`Injections logged: ${stats.total_injections}`);
  console.log(`Transcripts found: ${stats.transcripts_analyzed}`);
  console.log(`Avg token cost:    ~${stats.avg_token_estimate} tokens/session`);
  console.log(`Avg session:       ${stats.avg_session_duration_min || '?'} min\n`);

  if (stats.section_usage) {
    console.log('--- Section Usage Rates ---');
    for (const [section, data] of Object.entries(stats.section_usage)) {
      const bar = '█'.repeat(Math.round(parseInt(data.rate) / 5)) + '░'.repeat(20 - Math.round(parseInt(data.rate) / 5));
      console.log(`  ${section.padEnd(22)} ${bar} ${data.rate} (${data.used}/${data.total})`);
    }
  }

  if (stats.recommendations) {
    console.log('\n--- Recommendations ---');
    console.log(`  High value: ${stats.recommendations.high_value}`);
    console.log(`  Low value:  ${stats.recommendations.low_value}`);
    if (stats.recommendations.min_sessions_for_confidence > 0) {
      console.log(`  Need ${stats.recommendations.min_sessions_for_confidence} more sessions for confident recommendations`);
    }
  }

  // Show per-session detail for recent 5
  const recent = analyses.slice(-5);
  if (recent.some(a => a.transcript_found)) {
    console.log('\n--- Recent Sessions ---');
    for (const a of recent) {
      if (!a.transcript_found) {
        console.log(`  ${a.at.slice(0, 16)} [no transcript]`);
        continue;
      }
      const used = Object.entries(a.usage)
        .filter(([k, v]) => v === true || (Array.isArray(v) && v.length > 0))
        .map(([k]) => k.replace(/_/g, ' '))
        .join(', ');
      console.log(`  ${a.at.slice(0, 16)} | ${a.token_estimate}tk | ${a.session_duration_min || '?'}min | ${a.user_messages}msgs | ${used || 'none referenced'}`);
    }
  }

  console.log('');
}
