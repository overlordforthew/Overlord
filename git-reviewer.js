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

      state[name] = currentHash;
    } catch { /* skip unavailable repos */ }
  }

  saveState(state);
  return newCommits;
}

export async function reviewProject(projectName, commitRange = 'HEAD~1..HEAD') {
  const path = PROJECTS[projectName];
  if (!path) return `Unknown project: ${projectName}`;

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

    const prompt = `Review this git diff for the ${projectName} project. Focus on:

1. SECURITY: SQL injection, XSS, command injection, credential leaks, path traversal
2. BUGS: Logic errors, null refs, race conditions, off-by-ones
3. QUALITY: Dead code, duplicated logic, missing error handling at boundaries

Return a concise review with severity ratings (P0=critical, P1=important, P2=minor).
If the code looks clean, just say "Clean — no issues found."

Commits: ${logMsg}

Diff:
${diff.substring(0, 8000)}`;

    return new Promise((resolve, reject) => {
      let stdout = '';
      const proc = spawnWithMemoryLimit(CLAUDE_PATH, [
        '-p', '--output-format', 'json', '--max-turns', '1', '--model', 'claude-opus-4-6',
        '--allowedTools', 'Read,Grep,Glob',
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
          resolve(parsed.result?.trim() || stdout.trim());
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
