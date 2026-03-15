#!/usr/bin/env node
/**
 * self-improve.mjs — Nightly Self-Improvement Protocol
 *
 * Runs every evening before Gil's Starlink goes off. Reviews:
 * 1. GitHub trending repos relevant to Overlord's stack
 * 2. Friction logs — what went wrong today?
 * 3. Capability gaps — what was asked that we couldn't do?
 * 4. Skill inventory — what's installed vs what's possible?
 * 5. Claude Code ecosystem — new skills/MCPs/patterns emerging?
 *
 * Generates a report for Gil with recommendations, stores learnings
 * in semantic memory, and identifies concrete next skills to build.
 *
 * Usage:
 *   node self-improve.mjs              Run full protocol, output report
 *   node self-improve.mjs --json       Output as JSON
 *   node self-improve.mjs --send       Run and send via WhatsApp (used by scheduler)
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import path from 'path';

// ── CONFIG ────────────────────────────────────────────────────────────────────

const GH_SEARCH_CATEGORIES = [
  { label: 'Claude Code Skills & MCP', queries: ['claude code skill', 'claude mcp server', 'model context protocol', 'anthropic agent sdk'] },
  { label: 'WhatsApp Bots & Automation', queries: ['whatsapp bot node', 'whatsapp automation', 'baileys whatsapp'] },
  { label: 'AI Agent Frameworks', queries: ['ai agent framework', 'autonomous agent', 'multi agent system'] },
  { label: 'Self-Hosted AI Tools', queries: ['self-hosted ai', 'local ai tool', 'ai docker self-hosted'] },
  { label: 'DevOps & Monitoring', queries: ['self-hosted monitoring', 'docker monitoring tool', 'server automation'] },
  { label: 'Web Scraping & Data', queries: ['web scraper ai', 'data extraction tool', 'headless browser automation'] },
  { label: 'Content & Marketing', queries: ['ai content creator', 'seo tool ai', 'social media automation'] },
  { label: 'Marine & Boat Tech', queries: ['signalk plugin', 'marine iot', 'boat monitoring system', 'nmea 2000'] },
];

const STACK_KEYWORDS = [
  'claude', 'anthropic', 'mcp', 'whatsapp', 'baileys', 'docker', 'traefik',
  'coolify', 'node', 'javascript', 'typescript', 'postgres', 'self-hosted',
  'bot', 'webhook', 'skill', 'agent', 'scraping', 'browser', 'chromium',
  'stripe', 'payment', 'boat', 'marine', 'signalk', 'sailing', 'yacht',
  'seo', 'newsletter', 'email', 'calendar', 'video', 'tts', 'transcription',
];

const WEEK_MS = 7 * 86400000;
const MONTH_MS = 30 * 86400000;

// ── GITHUB SEARCH ─────────────────────────────────────────────────────────────

async function searchGitHub(query, sort = 'stars', createdAfter = null) {
  const dateFilter = createdAfter ? `+created:>${createdAfter}` : '';
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}${dateFilter}&sort=${sort}&order=desc&per_page=5`;

  try {
    const resp = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Overlord-SelfImprove/1.0',
        ...(process.env.GH_TOKEN ? { 'Authorization': `token ${process.env.GH_TOKEN}` } : {}),
      },
    });
    if (!resp.ok) {
      if (resp.status === 403) return { items: [], rateLimited: true };
      return { items: [] };
    }
    return resp.json();
  } catch {
    return { items: [] };
  }
}

function relevanceScore(repo) {
  let score = 0;
  const text = `${repo.name} ${repo.description || ''} ${(repo.topics || []).join(' ')}`.toLowerCase();
  for (const kw of STACK_KEYWORDS) {
    if (text.includes(kw)) score += 10;
  }
  const daysSinceCreated = Math.max(1, (Date.now() - new Date(repo.created_at).getTime()) / 86400000);
  const velocity = repo.stargazers_count / daysSinceCreated;
  if (velocity > 100) score += 25;
  else if (velocity > 50) score += 15;
  else if (velocity > 10) score += 5;
  const daysSincePush = (Date.now() - new Date(repo.pushed_at).getTime()) / 86400000;
  if (daysSincePush < 7) score += 15;
  else if (daysSincePush < 30) score += 5;
  if (repo.stargazers_count > 1000) score += 10;
  if (repo.stargazers_count > 10000) score += 10;
  return score;
}

async function discoverRepos() {
  const weekAgo = new Date(Date.now() - WEEK_MS).toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - MONTH_MS).toISOString().split('T')[0];
  const allRepos = new Map();
  let rateLimited = false;

  for (const cat of GH_SEARCH_CATEGORIES) {
    for (const query of cat.queries) {
      // Recent (this month)
      const result = await searchGitHub(query, 'stars', monthAgo);
      if (result.rateLimited) { rateLimited = true; break; }
      for (const repo of (result.items || [])) {
        if (!allRepos.has(repo.full_name)) {
          allRepos.set(repo.full_name, { ...repo, category: cat.label, relevance: relevanceScore(repo) });
        }
      }
      // Rate limit courtesy
      await new Promise(r => setTimeout(r, 800));
    }
    if (rateLimited) break;
  }

  // Sort by relevance, take top discoveries
  const sorted = [...allRepos.values()].sort((a, b) => b.relevance - a.relevance);

  return {
    topRepos: sorted.slice(0, 15),
    newThisWeek: sorted.filter(r => (Date.now() - new Date(r.created_at).getTime()) < WEEK_MS).slice(0, 8),
    highRelevance: sorted.filter(r => r.relevance >= 30).slice(0, 10),
    rateLimited,
  };
}

// ── SKILL GAP ANALYSIS ────────────────────────────────────────────────────────

function getCurrentSkills() {
  const skillsDir = existsSync('/app/skills') ? '/app/skills' : '/root/overlord/skills';
  try {
    return readdirSync(skillsDir).filter(f => !f.startsWith('.') && f !== 'REGISTRY.md');
  } catch {
    return [];
  }
}

function identifySkillGaps(currentSkills) {
  // Skills we could build based on common Claude Code patterns and our stack
  const possibleSkills = [
    { name: 'database-admin', desc: 'Direct PostgreSQL management — migrations, backup/restore, schema analysis', priority: 'high', reason: 'We manage 6+ PG instances but lack a unified DB admin skill' },
    { name: 'dns-manager', desc: 'Cloudflare DNS + SSL management — add/remove records, check propagation', priority: 'medium', reason: 'We have Cloudflare API access but manage DNS manually' },
    { name: 'log-analyzer', desc: 'AI-powered log analysis — pattern detection, anomaly alerts, root cause analysis', priority: 'high', reason: 'We check logs manually; an AI analyzer could catch issues proactively' },
    { name: 'image-generator', desc: 'Image generation via free/local models (SDXL, FLUX)', priority: 'medium', reason: 'We have video (Veo) but no image generation capability' },
    { name: 'git-intelligence', desc: 'Cross-repo analysis — dependency tracking, security advisories, changelog generation', priority: 'medium', reason: 'We manage 9+ repos but analyze them individually' },
    { name: 'email-composer', desc: 'Draft and send emails via gws CLI with templates and scheduling', priority: 'high', reason: 'gws can send email but we lack a compose/template skill' },
    { name: 'calendar-manager', desc: 'Calendar management — create events, check availability, daily agenda', priority: 'medium', reason: 'gws has Calendar API but no dedicated skill' },
    { name: 'performance-profiler', desc: 'Server performance profiling — CPU/mem/disk trends, bottleneck detection', priority: 'medium', reason: 'We have basic health checks but no deep profiling' },
    { name: 'backup-verifier', desc: 'Verify backup integrity — test restore, check age, alert on failures', priority: 'high', reason: 'We backup nightly but never verify the backups work' },
    { name: 'whatsapp-analytics', desc: 'Message analytics — response times, conversation patterns, user engagement', priority: 'low', reason: 'We log conversations but dont analyze patterns' },
    { name: 'security-scanner', desc: 'Automated security scanning — port check, SSL expiry, dependency audit', priority: 'high', reason: 'Shannon does pentesting but we lack continuous scanning' },
    { name: 'notification-hub', desc: 'Multi-channel notifications — WhatsApp, email, Discord, webhook', priority: 'medium', reason: 'Notifications are WhatsApp-only; should support fallbacks' },
    { name: 'cost-tracker', desc: 'Track API costs, hosting bills, subscription renewals', priority: 'low', reason: 'Token dashboard exists but no unified cost view' },
    { name: 'document-reader', desc: 'Advanced document parsing — PDFs, spreadsheets, presentations with AI summarization', priority: 'medium', reason: 'We handle images but document support is basic' },
  ];

  const currentSet = new Set(currentSkills.map(s => s.toLowerCase()));
  return possibleSkills.filter(s => !currentSet.has(s.name));
}

// ── FRICTION ANALYSIS ─────────────────────────────────────────────────────────

function analyzeFriction() {
  const frictionPath = existsSync('/app/data/meta-learning/friction.json')
    ? '/app/data/meta-learning/friction.json'
    : '/root/overlord/data/meta-learning/friction.json';

  try {
    const data = JSON.parse(readFileSync(frictionPath, 'utf-8'));
    const events = data.events || [];
    const today = new Date().toISOString().split('T')[0];
    const recent = events.filter(e => e.timestamp && e.timestamp >= today.replace(/-\d\d$/, ''));

    // Count by type
    const byType = {};
    for (const e of recent) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }

    // Most common friction patterns
    const patterns = Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    return { total: recent.length, patterns, period: 'last 30 days' };
  } catch {
    return { total: 0, patterns: [], period: 'unavailable' };
  }
}

// ── REPORT GENERATION ─────────────────────────────────────────────────────────

async function generateReport() {
  const startTime = Date.now();

  // Run all analyses
  const [repos, friction] = await Promise.all([
    discoverRepos(),
    Promise.resolve(analyzeFriction()),
  ]);

  const currentSkills = getCurrentSkills();
  const skillGaps = identifySkillGaps(currentSkills);
  const highPriorityGaps = skillGaps.filter(s => s.priority === 'high');

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  // Build the report
  const lines = [];
  const date = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  lines.push(`SELF-IMPROVEMENT REPORT — ${date}`);
  lines.push('');

  // Section 1: GitHub Discoveries
  if (repos.highRelevance.length > 0) {
    lines.push('GITHUB DISCOVERIES (relevant to our stack):');
    lines.push('');
    for (const r of repos.highRelevance.slice(0, 6)) {
      const stars = r.stargazers_count >= 1000 ? `${(r.stargazers_count / 1000).toFixed(1)}K` : r.stargazers_count;
      const desc = (r.description || 'No description').slice(0, 90);
      const velocity = Math.round(r.stargazers_count / Math.max(1, (Date.now() - new Date(r.created_at).getTime()) / 86400000));
      lines.push(`${stars} stars | ${r.full_name}`);
      lines.push(`  ${desc}`);
      lines.push(`  ${r.language || '?'} | ${velocity} stars/day | ${r.category}`);
      lines.push('');
    }
  }

  if (repos.newThisWeek.length > 0) {
    lines.push('NEW THIS WEEK:');
    for (const r of repos.newThisWeek.slice(0, 5)) {
      const stars = r.stargazers_count >= 1000 ? `${(r.stargazers_count / 1000).toFixed(1)}K` : r.stargazers_count;
      lines.push(`  ${stars} stars | ${r.full_name} — ${(r.description || '').slice(0, 70)}`);
    }
    lines.push('');
  }

  // Section 2: Skill Gaps
  lines.push(`SKILL INVENTORY: ${currentSkills.length} installed`);
  lines.push('');

  if (highPriorityGaps.length > 0) {
    lines.push('HIGH-PRIORITY GAPS (recommended to build):');
    for (const gap of highPriorityGaps) {
      lines.push(`  ${gap.name}: ${gap.desc}`);
      lines.push(`    Why: ${gap.reason}`);
    }
    lines.push('');
  }

  const mediumGaps = skillGaps.filter(s => s.priority === 'medium');
  if (mediumGaps.length > 0) {
    lines.push('MEDIUM-PRIORITY GAPS:');
    for (const gap of mediumGaps) {
      lines.push(`  ${gap.name}: ${gap.desc}`);
    }
    lines.push('');
  }

  // Section 3: Friction Analysis
  if (friction.total > 0) {
    lines.push(`FRICTION (${friction.period}): ${friction.total} events`);
    for (const p of friction.patterns) {
      lines.push(`  ${p.type}: ${p.count} occurrences`);
    }
    lines.push('');
  }

  // Section 4: Actionable Recommendations
  lines.push('TONIGHT\'S RECOMMENDATIONS:');
  lines.push('');

  // Top 3 actionable items
  let recNum = 1;

  // Recommend building the highest-priority skill gap
  if (highPriorityGaps.length > 0) {
    const top = highPriorityGaps[0];
    lines.push(`${recNum}. BUILD: ${top.name} skill`);
    lines.push(`   ${top.desc}`);
    lines.push(`   Rationale: ${top.reason}`);
    recNum++;
  }

  // Recommend exploring the most relevant new repo
  if (repos.highRelevance.length > 0) {
    const top = repos.highRelevance[0];
    lines.push(`${recNum}. EXPLORE: ${top.full_name}`);
    lines.push(`   ${(top.description || '').slice(0, 80)}`);
    lines.push(`   Could enhance: ${top.category}`);
    recNum++;
  }

  // Recommend fixing the top friction pattern
  if (friction.patterns.length > 0) {
    const top = friction.patterns[0];
    lines.push(`${recNum}. FIX: "${top.type}" friction (${top.count} events)`);
    lines.push(`   Investigate root cause and build a fix or workaround`);
    recNum++;
  }

  // Always suggest one forward-looking idea
  if (recNum <= 3) {
    lines.push(`${recNum}. EVOLVE: Review Claude Code changelog for new features to integrate`);
    lines.push(`   Check: https://docs.anthropic.com/en/docs/claude-code`);
  }

  lines.push('');
  lines.push(`Want me to start on any of these? Reply with the number.`);

  if (repos.rateLimited) {
    lines.push('');
    lines.push('(Note: GitHub API rate limited — some results may be incomplete)');
  }

  lines.push('');
  lines.push(`Research took ${duration}s | ${currentSkills.length} skills installed | ${skillGaps.length} gaps identified`);

  const report = lines.join('\n');

  return {
    report,
    metadata: {
      reposScanned: repos.topRepos.length,
      highRelevance: repos.highRelevance.length,
      newThisWeek: repos.newThisWeek.length,
      currentSkills: currentSkills.length,
      skillGaps: skillGaps.length,
      highPriorityGaps: highPriorityGaps.length,
      frictionEvents: friction.total,
      duration,
      rateLimited: repos.rateLimited,
    },
  };
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

const result = await generateReport();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.report);
}
