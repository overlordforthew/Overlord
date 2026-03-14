#!/usr/bin/env node
/**
 * github-trending.js — Weekly AI/agent repo intelligence report
 *
 * Searches GitHub API for trending AI repos and generates a WhatsApp-friendly
 * report with recommendations for Gil's stack.
 *
 * Usage: node github-trending.js [--json]
 */

const CATEGORIES = [
  { label: 'AI Agents & Assistants', query: 'ai agent OR ai assistant OR multi-agent OR autonomous agent' },
  { label: 'Claude Code / Skills', query: 'claude code OR claude skill OR anthropic agent' },
  { label: 'Developer Tools & CLI', query: 'ai cli OR ai developer tool OR code generation' },
  { label: 'Web Scraping & Data', query: 'ai scraping OR web scraper OR data extraction agent' },
  { label: 'Self-Hosted & Infrastructure', query: 'self-hosted ai OR ai docker OR ai infrastructure' },
];

const GIL_STACK_KEYWORDS = [
  'claude', 'anthropic', 'whatsapp', 'docker', 'traefik', 'coolify',
  'node', 'typescript', 'javascript', 'postgres', 'self-hosted',
  'scraping', 'scraper', 'bot', 'webhook', 'skill', 'agent',
  'seo', 'marketing', 'dns', 'deploy', 'monitor', 'backup',
  'stripe', 'payment', 'boat', 'marine', 'sailing',
];

async function searchGitHub(query, sort = 'stars', created = null) {
  const dateFilter = created ? `+created:>${created}` : '';
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}${dateFilter}&sort=${sort}&order=desc&per_page=10`;

  const resp = await fetch(url, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Overlord-Bot/1.0',
    },
  });

  if (!resp.ok) {
    if (resp.status === 403) return { items: [], rateLimited: true };
    throw new Error(`GitHub API ${resp.status}: ${resp.statusText}`);
  }

  return resp.json();
}

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function starsPerDay(stars, created) {
  const days = daysSince(created) || 1;
  return Math.round(stars / days);
}

function relevanceScore(repo) {
  let score = 0;
  const text = `${repo.name} ${repo.description || ''} ${repo.topics?.join(' ') || ''}`.toLowerCase();

  for (const kw of GIL_STACK_KEYWORDS) {
    if (text.includes(kw)) score += 10;
  }

  // Bonus for recent activity
  if (daysSince(repo.pushed_at) < 7) score += 15;

  // Bonus for good star velocity
  const velocity = starsPerDay(repo.stargazers_count, repo.created_at);
  if (velocity > 100) score += 20;
  else if (velocity > 50) score += 10;

  // Penalty for no description or very new with huge stars (likely fake)
  if (!repo.description) score -= 10;
  if (daysSince(repo.created_at) < 7 && repo.stargazers_count > 20000) score -= 15;

  return score;
}

function formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

async function generateReport() {
  const now = new Date();
  const weekAgo = new Date(now - 7 * 86400000).toISOString().split('T')[0];
  const monthAgo = new Date(now - 30 * 86400000).toISOString().split('T')[0];

  // Collect repos across all categories
  const allRepos = new Map(); // dedup by full_name
  let rateLimited = false;

  for (const cat of CATEGORIES) {
    try {
      // This week's fastest growing
      const weekly = await searchGitHub(cat.query, 'stars', weekAgo);
      if (weekly.rateLimited) { rateLimited = true; break; }

      for (const repo of (weekly.items || [])) {
        if (!allRepos.has(repo.full_name)) {
          allRepos.set(repo.full_name, { ...repo, category: cat.label, period: 'week' });
        }
      }

      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 1000));

      // This month's top
      const monthly = await searchGitHub(cat.query, 'stars', monthAgo);
      if (monthly.rateLimited) { rateLimited = true; break; }

      for (const repo of (monthly.items || [])) {
        if (!allRepos.has(repo.full_name)) {
          allRepos.set(repo.full_name, { ...repo, category: cat.label, period: 'month' });
        }
      }

      await new Promise(r => setTimeout(r, 1000));
    } catch (err) {
      console.error(`Error fetching ${cat.label}:`, err.message);
    }
  }

  if (rateLimited) {
    console.error('GitHub API rate limited — report may be incomplete');
  }

  // Score and sort all repos
  const scored = [...allRepos.values()]
    .map(r => ({ ...r, relevance: relevanceScore(r), velocity: starsPerDay(r.stargazers_count, r.created_at) }))
    .sort((a, b) => b.relevance - a.relevance || b.velocity - a.velocity);

  // Split into sections
  const thisWeekHot = scored
    .filter(r => daysSince(r.created_at) <= 14)
    .slice(0, 8);

  const fastestGrowing = [...scored]
    .sort((a, b) => b.velocity - a.velocity)
    .slice(0, 8);

  const relevantToStack = scored
    .filter(r => r.relevance >= 20)
    .slice(0, 8);

  // Format report
  const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const lines = [
    `WEEKLY AI REPO INTELLIGENCE — ${dateStr}`,
    '',
  ];

  // Section 1: This week's breakout repos
  if (thisWeekHot.length > 0) {
    lines.push('NEW THIS WEEK (breakout repos):');
    for (const r of thisWeekHot) {
      const desc = (r.description || 'No description').substring(0, 80);
      lines.push(`${formatNumber(r.stargazers_count)} stars | ${r.full_name}`);
      lines.push(`  ${desc}`);
      lines.push(`  ${r.velocity} stars/day | ${r.language || '?'}`);
      lines.push('');
    }
  }

  // Section 2: Fastest growing (star velocity)
  lines.push('FASTEST GROWING (stars/day):');
  for (const r of fastestGrowing) {
    lines.push(`${r.velocity}/day | ${r.full_name} (${formatNumber(r.stargazers_count)} total)`);
  }
  lines.push('');

  // Section 3: Most relevant to Gil's stack
  if (relevantToStack.length > 0) {
    lines.push('RELEVANT TO YOUR STACK:');
    for (const r of relevantToStack) {
      const desc = (r.description || '').substring(0, 80);
      const matchedKws = GIL_STACK_KEYWORDS
        .filter(kw => `${r.name} ${r.description || ''} ${r.topics?.join(' ') || ''}`.toLowerCase().includes(kw))
        .slice(0, 3);
      lines.push(`${formatNumber(r.stargazers_count)} stars | ${r.full_name}`);
      lines.push(`  ${desc}`);
      lines.push(`  Matches: ${matchedKws.join(', ')}`);
      lines.push('');
    }
  }

  // Section 4: Recommendations
  lines.push('RECOMMENDATIONS:');
  const topPicks = relevantToStack.slice(0, 3);
  if (topPicks.length > 0) {
    for (const r of topPicks) {
      const matchedKws = GIL_STACK_KEYWORDS
        .filter(kw => `${r.name} ${r.description || ''} ${r.topics?.join(' ') || ''}`.toLowerCase().includes(kw));

      let action = 'Worth studying';
      if (matchedKws.includes('claude') || matchedKws.includes('skill') || matchedKws.includes('agent')) {
        action = 'Could integrate into Overlord';
      } else if (matchedKws.includes('scraping') || matchedKws.includes('scraper')) {
        action = 'Could enhance /scrape skill';
      } else if (matchedKws.includes('self-hosted') || matchedKws.includes('docker')) {
        action = 'Could self-host on Hetzner';
      } else if (matchedKws.includes('monitor') || matchedKws.includes('deploy')) {
        action = 'Could improve ops workflow';
      }

      lines.push(`- ${r.full_name}: ${action}`);
    }
  } else {
    lines.push('- No standout picks this week');
  }

  if (rateLimited) {
    lines.push('', '(Note: GitHub API rate limited — some categories may be incomplete)');
  }

  return lines.join('\n');
}

// Run standalone
if (process.argv[1]?.endsWith('github-trending.js')) {
  generateReport()
    .then(report => {
      if (process.argv.includes('--json')) {
        console.log(JSON.stringify({ report }));
      } else {
        console.log(report);
      }
    })
    .catch(err => {
      console.error('Report generation failed:', err.message);
      process.exit(1);
    });
}

export { generateReport };
