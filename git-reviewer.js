/**
 * Git-Aware Code Reviews (#7) — Auto-review pushes across all projects
 *
 * Polls for new commits across repos, reviews diffs with project context.
 * Scores security, quality, patterns. Alerts on issues.
 * /review <project> for manual trigger
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { spawn } from 'child_process';
import { spawnWithMemoryLimit, getMemoryLimit } from './work-queue.js';
import pino from 'pino';
import { getIntelligenceBackend, runAgentIntelligence } from './intelligence-runtime.js';

const execAsync = promisify(exec);
const logger = pino({ level: 'info' });
const CLAUDE_PATH = process.env.CLAUDE_PATH || 'claude';

const STATE_FILE = '/app/data/git-review-state.json';

const PROJECTS = {
  NamiBarden: '/projects/NamiBarden',
  BeastMode: '/projects/BeastMode',
  Lumina: '/projects/Lumina',
  MasterCommander: '/projects/MasterCommander',
  SurfaBabe: '/projects/SurfaBabe',
  Elmo: '/projects/Elmo',
  OnlyHulls: '/projects/OnlyHulls',
  Overlord: '/root/overlord',
};

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf-8')); } catch { return {}; }
}

function saveState(state) {
  try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
}

export async function checkForNewCommits() {
  const state = loadState();
  const newCommits = [];
  let stateChanged = false;

  for (const [name, path] of Object.entries(PROJECTS)) {
    try {
      // Fetch latest from remote
      await execAsync(`cd "${path}" && git fetch origin 2>/dev/null`, { timeout: 15000 }).catch(() => {});

      const { stdout: headHash } = await execAsync(
        `cd "${path}" && git rev-parse HEAD 2>/dev/null`,
        { timeout: 5000 }
      );
      const currentHash = headHash.trim();
      const lastKnown = state[name];

      if (lastKnown && lastKnown !== currentHash) {
        // New commit detected
        const { stdout: log } = await execAsync(
          `cd "${path}" && git log ${lastKnown}..${currentHash} --oneline 2>/dev/null || git log -1 --oneline`,
          { timeout: 5000 }
        );
        newCommits.push({ name, path, from: lastKnown, to: currentHash, log: log.trim() });
      }

      if (state[name] !== currentHash) {
        state[name] = currentHash;
        stateChanged = true;
      }
    } catch { /* skip unavailable repos */ }
  }

  if (stateChanged) saveState(state);
  return newCommits;
}

export async function reviewProject(projectName, commitRange = 'HEAD~1..HEAD') {
  // Case-insensitive lookup
  const key = Object.keys(PROJECTS).find(k => k.toLowerCase() === projectName.toLowerCase());
  const path = key ? PROJECTS[key] : null;
  if (!path) return `Unknown project: ${projectName}. Available: ${Object.keys(PROJECTS).join(', ')}`;

  try {
    const { stdout: diff } = await execAsync(
      `cd "${path}" && git diff ${commitRange} 2>/dev/null | head -3000`,
      { timeout: 15000 }
    );

    if (!diff.trim()) return `No changes to review in ${projectName}.`;

    const { stdout: logMsg } = await execAsync(
      `cd "${path}" && git log ${commitRange} --oneline 2>/dev/null | head -5`,
      { timeout: 5000 }
    );

    // Run semgrep on changed files for static analysis
    let semgrepFindings = '';
    try {
      const { stdout: changedFiles } = await execAsync(
        `cd "${path}" && git diff ${commitRange} --name-only --diff-filter=ACMR 2>/dev/null`,
        { timeout: 5000 }
      );
      const files = changedFiles.trim().split('\n').filter(f => /\.(js|ts|py|jsx|tsx|mjs)$/.test(f));
      if (files.length > 0 && files.length <= 20) {
        const { stdout: semgrepOut } = await execAsync(
          `cd "${path}" && semgrep --config auto --json --timeout 30 ${files.join(' ')} 2>/dev/null`,
          { timeout: 60000 }
        );
        const parsed = JSON.parse(semgrepOut);
        if (parsed.results?.length > 0) {
          semgrepFindings = `\n\nSemgrep static analysis found ${parsed.results.length} issue(s):\n`;
          for (const r of parsed.results.slice(0, 10)) {
            semgrepFindings += `- [${r.extra?.severity || 'INFO'}] ${r.extra?.message || r.check_id} at ${r.path}:${r.start?.line}\n`;
          }
        }
      }
    } catch { /* semgrep not critical */ }

    const prompt = `Review this git diff for the ${projectName} project. Focus on:

1. SECURITY: SQL injection, XSS, command injection, credential leaks, path traversal
2. BUGS: Logic errors, null refs, race conditions, off-by-ones
3. QUALITY: Dead code, duplicated logic, missing error handling at boundaries
${semgrepFindings ? `\nStatic analysis (Semgrep):\n${semgrepFindings}` : ''}
Return a concise review with severity ratings (P0=critical, P1=important, P2=minor).
If the code looks clean, just say "Clean — no issues found."

Commits: ${logMsg}

Diff:
${diff.substring(0, 8000)}`;

    if (getIntelligenceBackend() !== 'claude') {
      const result = await runAgentIntelligence({
        systemPrompt: 'You are a code reviewer. Focus on bugs, regressions, security risks, and missing tests.',
        userPrompt: prompt,
        cwd: path,
        timeoutMs: 120000,
        role: 'user',
        requestedModel: 'claude-opus-4-7',
      });
      return result.text || 'Review produced no output.';
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      const proc = spawnWithMemoryLimit(CLAUDE_PATH, [
        '-p', '--output-format', 'json', '--model', 'claude-opus-4-7',
        '--max-turns', '1',
      ], {
        cwd: path,
        timeout: 120000,
        env: { HOME: process.env.HOME || '/root', PATH: process.env.PATH, TERM: 'dumb', NODE_OPTIONS: '--max-old-space-size=1024' },
      }, getMemoryLimit('medium'));

      proc.stdin.write(prompt);
      proc.stdin.end();
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.on('close', () => {
        try {
          const parsed = JSON.parse(stdout.trim());
          if (parsed.result?.trim()) {
            resolve(parsed.result.trim());
          } else if (parsed.subtype === 'error_max_turns') {
            resolve('Review incomplete — model hit turn limit. Diff may need manual review.');
          } else {
            resolve(parsed.result || 'Review produced no output.');
          }
        } catch {
          resolve(stdout.trim() || 'Review produced no output.');
        }
      });
      proc.on('error', () => resolve('Review failed to spawn.'));
    });
  } catch (err) {
    return `Review failed: ${err.message}`;
  }
}

export async function autoReviewNewCommits(sendAlert) {
  const commits = await checkForNewCommits();

  for (const commit of commits) {
    // Skip Overlord's own commits (already reviewed by codex)
    if (commit.name === 'Overlord') continue;

    logger.info({ project: commit.name, commits: commit.log }, 'Auto-reviewing new commits');

    try {
      const review = await reviewProject(commit.name, `${commit.from}..${commit.to}`);

      // Only alert if issues found
      if (review && !review.includes('Clean') && !review.includes('no issues')) {
        const msg = `🔍 *Auto Code Review: ${commit.name}*\n\nCommits:\n${commit.log}\n\n${review.substring(0, 1500)}`;
        if (sendAlert) await sendAlert(msg);
      }
    } catch (err) {
      logger.warn({ err: err.message, project: commit.name }, 'Auto-review failed');
    }
  }
}
