/**
 * Idle Study Engine — Active learning when Overlord has no messages
 *
 * Three rotating study modes (inspired by CashClaw):
 *   1. CORRECTION REVIEW — Parse recent conversations for corrections, extract patterns
 *   2. DOMAIN STUDY — Browse competitor sites for priority project, store insights
 *   3. SKILL PRACTICE — Attempt improvement on test branch, self-evaluate
 *
 * Triggers when no messages for 30+ min during waking hours (5:30am-9pm AST)
 * Runs one mode per idle period, rotates through them
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { evolve, extractLearningSignals } from './evolution-engine.js';
import { getLatestScorecard } from './portfolio-scorecard.js';
import { pickTask, recordAttempt, getPracticeStats } from './practice-engine.js';
import {
  analyzeOptionalOpenRouterFailure,
  describeOptionalOpenRouterPause,
  getOptionalOpenRouterPause,
  pauseOptionalOpenRouter,
} from './lib/optional-openrouter.js';

const STUDY_STATE_PATH = '/app/data/study-state.json';
const STUDY_LOG_PATH = '/app/data/study-log.jsonl';
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

const STUDY_MODES = ['correction_review', 'domain_study', 'skill_practice'];

const WAKING_HOURS = { start: 5.5, end: 21 }; // 5:30am - 9pm AST

// Competitor sites for domain study (by project)
const COMPETITOR_SITES = {
  OnlyHulls: ['boats.com', 'yachtworld.com', 'boattrader.com', 'sailboatlistings.com'],
  BeastMode: ['fitbod.me', 'strong.app', 'hevy.com'],
  MasterCommander: ['sea-of-thieves.com', 'worldofwarships.com'],
  SurfaBabe: ['surfline.com', 'magicseaweed.com', 'wannasurf.com'],
  Lumina: ['headspace.com', 'calm.com', 'daylio.net'],
};

function loadState() {
  try {
    return JSON.parse(readFileSync(STUDY_STATE_PATH, 'utf8'));
  } catch {
    return { lastMode: -1, lastStudyAt: null, sessionCount: 0 };
  }
}

function saveState(state) {
  writeFileSync(STUDY_STATE_PATH, JSON.stringify(state, null, 2));
}

function isWakingHours() {
  const now = new Date();
  // AST = UTC-4
  const astHour = (now.getUTCHours() - 4 + 24) % 24 + now.getUTCMinutes() / 60;
  return astHour >= WAKING_HOURS.start && astHour <= WAKING_HOURS.end;
}

function logStudy(mode, result) {
  const entry = {
    timestamp: new Date().toISOString(),
    mode,
    ...result,
  };
  try {
    appendFileSync(STUDY_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch { /* non-critical */ }
}

// ============================================================
// STUDY MODES
// ============================================================

/**
 * Mode 1: CORRECTION REVIEW
 * Parse recent conversations for corrections Gil made, feed into evolution engine
 */
async function correctionReview() {
  console.log('[Study] Mode: Correction Review');

  try {
    // Query recent admin conversations from DB
    const result = execSync(
      `docker exec overlord-db psql -U overlord -d overlord -t -A -c "
        SELECT user_message, assistant_response, created_at
        FROM conversations
        WHERE sender_jid LIKE '%${process.env.ADMIN_NUMBER}%'
          AND created_at > NOW() - INTERVAL '48 hours'
        ORDER BY created_at DESC
        LIMIT 20
      " 2>/dev/null`,
      { encoding: 'utf8', timeout: 10000 }
    ).trim();

    if (!result) return { found: 0, applied: 0 };

    const messages = result.split('\n').map(line => {
      const [text, , timestamp] = line.split('|');
      return { text, role: 'user', timestamp };
    }).filter(m => m.text);

    const signals = extractLearningSignals(messages);
    if (signals.corrections.length === 0 && signals.preferences.length === 0) {
      return { found: 0, applied: 0, detail: 'No corrections found in recent conversations' };
    }

    // Run evolution pipeline on found signals
    const evolution = await evolve(messages);
    return {
      found: signals.corrections.length + signals.preferences.length,
      applied: evolution.applied,
      detail: `Found ${signals.corrections.length} corrections, ${signals.preferences.length} preferences`,
    };
  } catch (err) {
    return { found: 0, applied: 0, error: err.message };
  }
}

/**
 * Mode 2: DOMAIN STUDY
 * Browse competitor sites for the highest-priority project, analyze UX
 */
async function domainStudy() {
  console.log('[Study] Mode: Domain Study');

  // Get priority project from scorecard
  let targetProject = 'OnlyHulls'; // default
  try {
    const scorecard = getLatestScorecard();
    if (scorecard?.projects?.length > 0) {
      // Study the highest-scoring project (double down = learn more about the domain)
      targetProject = scorecard.projects[0].name;
    }
  } catch { /* use default */ }

  const competitors = COMPETITOR_SITES[targetProject] || [];
  if (competitors.length === 0) {
    return { project: targetProject, sites: 0, detail: 'No competitor sites configured' };
  }

  // Pick a random competitor to study
  const site = competitors[Math.floor(Math.random() * competitors.length)];
  let analysis = '';

  try {
    // Use SearXNG for research (no API key needed)
    const searchResult = execSync(
      `curl -s "http://searxng:8080/search?q=${encodeURIComponent(site + ' features UX design')}&format=json" 2>/dev/null | head -c 3000`,
      { encoding: 'utf8', timeout: 15000 }
    );
    const data = JSON.parse(searchResult);
    const snippets = (data.results || []).slice(0, 5).map(r => `${r.title}: ${r.content}`).join('\n');

    if (snippets) {
      // Use free LLM to analyze competitor
      analysis = execSync(
        `echo ${JSON.stringify(`Analyze this competitor site for ${targetProject}: ${site}\n\nSearch results:\n${snippets}\n\nList 3 specific UX patterns or features that ${targetProject} should steal. Be concrete.`)} | llm -m openrouter/openrouter/free 2>/dev/null`,
        { encoding: 'utf8', timeout: 30000 }
      ).trim();
    }
  } catch (err) {
    analysis = `Research failed: ${err.message}`;
  }

  // Store in memory
  if (analysis && analysis.length > 50) {
    try {
      spawnSync('docker', ['exec', 'overlord', 'mem', 'save', `domain/${targetProject}`, `Competitor study: ${site} — ${analysis.substring(0, 500)}`],
        { encoding: 'utf8', timeout: 10000, stdio: 'pipe' }
      );
    } catch { /* non-critical */ }
  }

  return {
    project: targetProject,
    site,
    analysisLength: analysis.length,
    detail: `Studied ${site} for ${targetProject} patterns`,
  };
}

// ============================================================
// FREE LLM + SANDBOX HELPERS
// ============================================================

const SANDBOX_URL = 'http://overlord-sandbox:3099';
const SANDBOX_TOKEN = process.env.SANDBOX_TOKEN || 'overlord-sandbox-internal';
const RANKINGS_PATH = '/app/data/free-model-rankings.json';
const MODEL_COOLDOWN_PATH = '/app/data/model-cooldowns.json';
const MODEL_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours
const FALLBACK_MODELS = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'arcee-ai/trinity-large-preview:free',
  'z-ai/glm-4.5-air:free',
];

function loadModelCooldowns() {
  try {
    return JSON.parse(readFileSync(MODEL_COOLDOWN_PATH, 'utf8'));
  } catch { return {}; }
}

function saveModelCooldowns(cooldowns) {
  writeFileSync(MODEL_COOLDOWN_PATH, JSON.stringify(cooldowns));
}

function isModelCoolingDown(model) {
  const cooldowns = loadModelCooldowns();
  const until = cooldowns[model];
  if (!until) return false;
  if (Date.now() < until) return true;
  // Expired — clean up
  delete cooldowns[model];
  saveModelCooldowns(cooldowns);
  return false;
}

function coolDownModel(model) {
  const cooldowns = loadModelCooldowns();
  cooldowns[model] = Date.now() + MODEL_COOLDOWN_MS;
  saveModelCooldowns(cooldowns);
}

function getFreeModels() {
  try {
    const rankings = JSON.parse(readFileSync(RANKINGS_PATH, 'utf8'));
    if (rankings.topModels?.length >= 2) return rankings.topModels;
  } catch { /* no rankings yet, use fallback */ }
  return FALLBACK_MODELS;
}

async function callFreeLLM(prompt, maxTokens = 1500) {
  const key = process.env.OPENROUTER_KEY;
  if (!key) {
    console.log('[Study] Free-model study skipped: OPENROUTER_KEY missing');
    return '';
  }

  const globalPause = getOptionalOpenRouterPause();
  if (globalPause) {
    console.log(`[Study] Free-model study paused: ${describeOptionalOpenRouterPause(globalPause)}`);
    return '';
  }

  const models = getFreeModels();
  for (const model of models) {
    if (isModelCoolingDown(model)) continue;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer': 'https://namibarden.com',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(60000),
      });
      const raw = await res.text();
      let data = {};
      try {
        data = JSON.parse(raw);
      } catch {}

      if (!res.ok || data.error) {
        const failure = analyzeOptionalOpenRouterFailure({
          status: res.status,
          errorText: data?.error?.message || raw,
        });
        if (failure.cooldownMs) {
          const pause = pauseOptionalOpenRouter(failure.kind, failure.summary, failure.cooldownMs);
          console.log(`[Study] Free-model study paused: ${describeOptionalOpenRouterPause(pause)}`);
          return '';
        }
        console.log(`[Study] LLM skip: ${model} — ${failure.summary}`);
        coolDownModel(model);
        continue;
      }

      let text = data.choices?.[0]?.message?.content?.trim() || '';
      // Strip thinking blocks from reasoning models (Qwen, etc)
      text = text.replace(/^<think>[\s\S]*?<\/think>\s*/m, '').trim();
      if (text && text.length > 10) {
        console.log(`[Study] LLM OK: ${model} (${text.length} chars)`);
        return text;
      }
      console.log(`[Study] LLM skip: ${model} — empty response`);
    } catch (err) {
      const failure = analyzeOptionalOpenRouterFailure({ errorText: err.message });
      if (failure.cooldownMs) {
        const pause = pauseOptionalOpenRouter(failure.kind, failure.summary, failure.cooldownMs);
        console.log(`[Study] Free-model study paused: ${describeOptionalOpenRouterPause(pause)}`);
        return '';
      }
      console.log(`[Study] LLM fail: ${model} — ${failure.summary}`);
      coolDownModel(model);
    }
  }
  return '';
}

async function executeCodeInSandbox(code) {
  try {
    const res = await fetch(`${SANDBOX_URL}/api/execute/code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SANDBOX_TOKEN}` },
      body: JSON.stringify({ code, timeout: 5000 }),
      signal: AbortSignal.timeout(15000),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function saveHtmlInSandbox(html, name) {
  try {
    const res = await fetch(`${SANDBOX_URL}/api/execute/html`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SANDBOX_TOKEN}` },
      body: JSON.stringify({ html, name }),
      signal: AbortSignal.timeout(15000),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function stripFences(text) {
  return text.replace(/^```(?:javascript|js|html|css)?\n?/m, '').replace(/\n?```\s*$/m, '').trim();
}

async function selfEvaluate(task, generated, execResult) {
  const codeCtx = task.type === 'code'
    ? `Execution: ${execResult?.ok ? 'passed' : 'failed — ' + (execResult?.error || 'unknown')}\nOutput:\n${(execResult?.logs || []).join('\n').substring(0, 500)}`
    : task.type === 'frontend'
    ? `Saved as HTML component.`
    : '';

  const criteria = task.type === 'code' ? 'correctness, edge cases, code quality'
    : task.type === 'frontend' ? 'responsive design, accessibility, visual quality, clean code'
    : 'specificity, actionability, insight quality';

  const evalRaw = await callFreeLLM(
    `Rate this solution 1-5. Be honest and critical.\nTask: "${task.task}"\nType: ${task.type}\nSolution:\n${generated.substring(0, 2000)}\n${codeCtx}\n\nCriteria: ${criteria}\nRespond with ONLY a JSON object: {"grade": N, "assessment": "one sentence", "lesson": "one sentence of what to do differently next time"}`,
    300
  );

  try {
    const match = evalRaw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch { /* parse failed */ }
  return { grade: 3, assessment: evalRaw.substring(0, 200), lesson: '' };
}

// ============================================================
// MODE 3: SKILL PRACTICE (uses sandbox)
// ============================================================

/**
 * Mode 3: SKILL PRACTICE
 * Pick a task, generate a solution with free LLM, execute/save in sandbox,
 * self-evaluate, record the attempt for tracking and Gil's review.
 */
async function skillPractice() {
  console.log('[Study] Mode: Skill Practice');

  try {
    const stats = getPracticeStats();
    const preferType = stats.weakestArea || null;
    const task = pickTask(preferType);
    if (!task) return { detail: 'No practice tasks available' };

    console.log(`[Study] Practice: ${task.type} — ${task.task}`);

    let generated = '';
    let execResult = null;

    if (task.type === 'code') {
      generated = await callFreeLLM(
        `Write the following as a self-contained JavaScript snippet. Include console.log() calls that demonstrate it works with test cases. Return ONLY the code — no markdown fences, no explanation.\n\nTask: ${task.task}`,
        1000
      );
      if (!generated) return { task: task.task, detail: 'LLM generation failed' };
      generated = stripFences(generated);
      execResult = await executeCodeInSandbox(generated);
      console.log(`[Study] Code exec: ${execResult.ok ? 'OK' : 'FAIL'} (${execResult.ms}ms) — ${execResult.error || (execResult.logs || []).slice(0, 3).join('; ')}`);

    } else if (task.type === 'frontend') {
      generated = await callFreeLLM(
        `Build the following as a single self-contained HTML file with embedded CSS and JS. Modern design, responsive, clean code. Return ONLY the complete HTML — no markdown fences, no explanation.\n\nTask: ${task.task}`,
        1500
      );
      if (!generated) return { task: task.task, detail: 'LLM generation failed' };
      generated = stripFences(generated);
      const safeName = task.task.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
      execResult = await saveHtmlInSandbox(generated, safeName);
      console.log(`[Study] HTML saved: ${execResult.ok ? execResult.url : execResult.error}`);

    } else {
      // design / business — pure analysis, no sandbox execution
      const role = task.type === 'design' ? 'senior UX designer' : 'business strategist';
      generated = await callFreeLLM(
        `You are a ${role}. Complete this task thoroughly and concretely:\n\n${task.task}\n\nBe specific — name real patterns, give real examples, provide actionable steps.`,
        1000
      );
      if (!generated) return { task: task.task, detail: 'LLM generation failed' };
      execResult = { ok: true, result: 'analysis' };
    }

    // Self-evaluate
    const evaluation = await selfEvaluate(task, generated, execResult);
    const grade = Math.min(5, Math.max(1, parseInt(evaluation.grade) || 3));
    const outcome = execResult?.ok === false ? 'failure'
      : grade >= 4 ? 'success'
      : grade >= 3 ? 'partial'
      : 'failure';

    // Record
    const attempt = recordAttempt({
      type: task.type,
      task: task.task,
      attempt: generated.substring(0, 1000),
      selfAssessment: (evaluation.assessment || '').substring(0, 300),
      selfGrade: grade,
      outcome,
      lesson: (evaluation.lesson || '').substring(0, 200),
      sandboxPath: execResult?.url || null,
    });

    console.log(`[Study] Recorded #${attempt.id}: ${task.type}/${task.task.substring(0, 40)} — ${grade}/5 — ${outcome}`);

    return {
      task: task.task,
      type: task.type,
      grade,
      outcome,
      lesson: evaluation.lesson,
      url: execResult?.url || null,
      detail: `Practiced: ${task.task.substring(0, 60)} (${grade}/5)`,
    };
  } catch (err) {
    console.error('[Study] Skill practice error:', err.message);
    return { error: err.message };
  }
}

// ============================================================
// MAIN RUNNER
// ============================================================

/**
 * Run one idle study session. Called by scheduler when idle detected.
 */
export async function runStudySession(sockRef) {
  if (!isWakingHours()) {
    console.log('[Study] Outside waking hours, skipping');
    return null;
  }

  const state = loadState();

  // Rotate to next mode
  const modeIdx = (state.lastMode + 1) % STUDY_MODES.length;
  const mode = STUDY_MODES[modeIdx];

  console.log(`[Study] Starting session #${state.sessionCount + 1}: ${mode}`);

  let result;
  try {
    switch (mode) {
      case 'correction_review':
        result = await correctionReview();
        break;
      case 'domain_study':
        result = await domainStudy();
        break;
      case 'skill_practice':
        result = await skillPractice();
        break;
    }
  } catch (err) {
    result = { error: err.message };
  }

  // Update state
  state.lastMode = modeIdx;
  state.lastStudyAt = new Date().toISOString();
  state.sessionCount += 1;
  saveState(state);

  // Log
  logStudy(mode, result || {});
  console.log(`[Study] Session complete: ${mode}`, result);

  return { mode, result };
}

/**
 * Get study context for prompt injection
 */
export function getStudyContext() {
  try {
    const state = JSON.parse(readFileSync(STUDY_STATE_PATH, 'utf8'));
    if (!state.lastStudyAt) return '';
    const age = Date.now() - new Date(state.lastStudyAt).getTime();
    if (age > 24 * 60 * 60 * 1000) return ''; // stale
    return `STUDY: ${state.sessionCount} sessions completed. Last: ${STUDY_MODES[state.lastMode]} (${new Date(state.lastStudyAt).toLocaleTimeString()})`;
  } catch { return ''; }
}
