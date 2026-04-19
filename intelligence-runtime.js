/**
 * Intelligence Runtime
 *
 * Centralizes backend selection for Overlord's "thinking" surfaces so we can
 * switch between Codex/GPT, Claude CLI, or a stateless API backend without
 * editing each caller.
 */

import { spawn } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

const SAFE_ENV_KEYS = new Set([
  'HOME', 'USER', 'PATH', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP',
  'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_RUNTIME_DIR',
  'HOSTNAME', 'PWD', 'LOGNAME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
  'CODEX_HOME', 'NODE_OPTIONS', 'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
]);

function buildSafeEnv(extra = {}) {
  const safe = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key]) safe[key] = process.env[key];
  }
  safe.TERM = 'dumb';
  safe.NODE_OPTIONS = '--max-old-space-size=1024';
  safe.CLAUDE_CODE_MAX_OUTPUT_TOKENS = process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS || '16000';
  safe.HOME = process.env.HOME || process.env.USERPROFILE || safe.HOME || '/root';
  safe.PATH = process.env.PATH || safe.PATH || '/usr/local/bin:/usr/bin:/bin';
  return { ...safe, ...extra };
}

function loadIntelligenceConfig() {
  return {
    backend: (process.env.INTELLIGENCE_BACKEND || 'claude').trim().toLowerCase(),
    fallbackBackend: (process.env.INTELLIGENCE_FALLBACK_BACKEND || 'claude').trim().toLowerCase(),
    model: (process.env.INTELLIGENCE_MODEL || 'gpt-5.4').trim(),
    reasoningEffort: (process.env.INTELLIGENCE_REASONING_EFFORT || 'xhigh').trim().toLowerCase(),
    claudePath: (process.env.CLAUDE_PATH || 'claude').trim(),
    claudeModel: (process.env.CLAUDE_MODEL || 'claude-opus-4-7').trim(),
    codexPath: (process.env.CODEX_PATH || 'codex').trim(),
    apiModel: (process.env.INTELLIGENCE_API_MODEL || 'deepseek/deepseek-v3.2').trim(),
    apiBaseUrl: (process.env.INTELLIGENCE_API_BASE_URL || 'https://openrouter.ai/api/v1/chat/completions').trim(),
    apiKey: process.env.OPENROUTER_KEY || '',
  };
}

export function getIntelligenceConfig() {
  const raw = loadIntelligenceConfig();
  return {
    backend: raw.backend,
    fallbackBackend: raw.fallbackBackend,
    model: raw.model,
    reasoningEffort: raw.reasoningEffort,
    claudePath: raw.claudePath,
    claudeModel: raw.claudeModel,
    codexPath: raw.codexPath,
    apiModel: raw.apiModel,
    apiBaseUrl: raw.apiBaseUrl,
    apiKeyConfigured: Boolean(raw.apiKey),
  };
}

export function getIntelligenceBackend() {
  return loadIntelligenceConfig().backend;
}

export function resolveIntelligenceModel(requestedModel = '') {
  return resolveModelForBackend(loadIntelligenceConfig().backend, requestedModel);
}

export function resolveIntelligenceVia(routeVia = 'claude-cli') {
  const backend = getIntelligenceBackend();
  if (routeVia === 'openrouter-api' || routeVia === 'gemini-api') return routeVia;
  if (backend === 'claude') return 'claude-cli';
  if (backend === 'api') return 'openrouter-api';
  return 'codex-cli';
}

function sandboxForRole(role = 'user') {
  switch (role) {
    case 'admin':
    case 'task':
      return 'danger-full-access';
    case 'power':
      return 'workspace-write';
    default:
      return 'read-only';
  }
}

function buildCombinedPrompt(systemPrompt, userPrompt) {
  if (systemPrompt && userPrompt) {
    return `[SYSTEM INSTRUCTIONS]\n${systemPrompt}\n\n[USER TASK]\n${userPrompt}`;
  }
  return systemPrompt || userPrompt || '';
}

function parseJsonLines(rawText) {
  const events = [];
  for (const line of String(rawText || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {
      // Ignore noisy non-JSON diagnostic lines.
    }
  }
  return events;
}

function resolveModelForBackend(backend, requestedModel = '') {
  const config = loadIntelligenceConfig();
  if (backend === 'claude') {
    return requestedModel || config.claudeModel;
  }
  if (backend === 'api') {
    return requestedModel || config.apiModel;
  }
  return requestedModel || config.model;
}

function routeViaForBackend(backend) {
  if (backend === 'claude') return 'claude-cli';
  if (backend === 'api') return 'openrouter-api';
  return 'codex-cli';
}

function annotateRuntimeResult(result, {
  backendUsed,
  requestedBackend = backendUsed,
  fallbackFrom = null,
}) {
  return {
    ...result,
    backendUsed,
    requestedBackend,
    fallbackFrom,
    routeVia: routeViaForBackend(backendUsed),
  };
}

function shouldFallbackFromCodex(err) {
  const text = String(err?.message || err || '');
  return /responses_websocket|failed to connect to websocket|http error:\s*5\d\d|unexpected argument|trusted directory|Codex exited|Codex spawn failed/i.test(text);
}

function buildCodexSpawn(config, args) {
  if (process.platform === 'win32') {
    const rawCommand = config.codexPath || 'codex';
    const command = /\.(cmd|bat)$/i.test(rawCommand) ? rawCommand : `${rawCommand}.cmd`;
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args],
    };
  }
  return {
    command: config.codexPath,
    args,
  };
}

async function runCodexTask({
  systemPrompt = '',
  userPrompt = '',
  cwd = process.cwd(),
  additionalDirs = [],
  timeoutMs = 300000,
  search = false,
  role = 'user',
  requestedModel = '',
}) {
  const config = loadIntelligenceConfig();
  const prompt = buildCombinedPrompt(systemPrompt, userPrompt);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'overlord-codex-'));
  const lastMessagePath = path.join(tempDir, 'last-message.txt');

  const args = [
    'exec',
    '-',
    '--json',
    '--color', 'never',
    '--output-last-message', lastMessagePath,
    '--skip-git-repo-check',
    '-C', cwd,
    '-m', resolveModelForBackend('codex', requestedModel),
    '-s', sandboxForRole(role),
    '-c', 'approval_policy="never"',
    '-c', `model_reasoning_effort="${config.reasoningEffort}"`,
  ];

  for (const dir of additionalDirs.filter(Boolean)) {
    args.push('--add-dir', dir);
  }
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const spawnConfig = buildCodexSpawn(config, args);
    const proc = spawn(spawnConfig.command, spawnConfig.args, {
      cwd,
      timeout: timeoutMs,
      env: buildSafeEnv(),
      windowsHide: true,
    });

    proc.stdin.write(prompt);
    proc.stdin.end();
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      try {
        const events = parseJsonLines(stdout);
        const threadStarted = events.find((event) => event.type === 'thread.started');
        const text = existsSync(lastMessagePath) ? readFileSync(lastMessagePath, 'utf8').trim() : '';
        if (code !== 0 && !text) {
          reject(new Error(`Codex exited ${code}: ${(stderr || stdout).trim().slice(0, 400)}`));
          return;
        }
        resolve({
          text: text || '',
          sessionId: threadStarted?.thread_id || null,
          modelId: resolveModelForBackend('codex', requestedModel),
          rawStdout: stdout,
          rawStderr: stderr,
        });
      } finally {
        try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      }
    });

    proc.on('error', (err) => {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
      reject(new Error(`Codex spawn failed: ${err.message}`));
    });
  });
}

async function runClaudeTask({
  systemPrompt = '',
  userPrompt = '',
  cwd = process.cwd(),
  additionalDirs = [],
  allowedTools = null,
  timeoutMs = 300000,
  maxTurns = 50,
  requestedModel = '',
  sessionId = null,
  outputFormat = 'json',
}) {
  const config = loadIntelligenceConfig();
  const args = ['-p', '--output-format', outputFormat, '--max-turns', String(maxTurns), '--model', resolveModelForBackend('claude', requestedModel)];
  if (sessionId) args.push('--resume', sessionId);
  for (const dir of additionalDirs.filter(Boolean)) {
    args.push('--add-dir', dir);
  }
  if (allowedTools) args.push('--allowedTools', allowedTools);
  if (systemPrompt) args.push('--append-system-prompt', systemPrompt);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const proc = spawn(config.claudePath, args, {
      cwd,
      timeout: timeoutMs,
      env: buildSafeEnv(),
      windowsHide: true,
    });
    proc.stdin.write(userPrompt);
    proc.stdin.end();
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Claude exited ${code}: ${(stderr || '').trim().slice(0, 400)}`));
        return;
      }

      if (outputFormat === 'json') {
        try {
          const parsed = JSON.parse(stdout.trim());
          resolve({
            text: (parsed.result || '').trim(),
            sessionId: parsed.session_id || null,
            modelId: parsed.model || resolveModelForBackend('claude', requestedModel),
            rawStdout: stdout,
            rawStderr: stderr,
          });
          return;
        } catch {
          // Fall back to raw text below.
        }
      }

      resolve({
        text: stdout.trim(),
        sessionId: null,
        modelId: resolveModelForBackend('claude', requestedModel),
        rawStdout: stdout,
        rawStderr: stderr,
      });
    });

    proc.on('error', (err) => reject(new Error(`Claude spawn failed: ${err.message}`)));
  });
}

async function runApiTextTask({
  systemPrompt = '',
  userPrompt = '',
  timeoutMs = 300000,
  requestedModel = '',
  jsonMode = false,
}) {
  const config = loadIntelligenceConfig();
  if (!config.apiKey) throw new Error('OPENROUTER_KEY not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(config.apiBaseUrl, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'HTTP-Referer': 'https://namibarden.com',
        'X-Title': 'Overlord Intelligence Runtime',
      },
      body: JSON.stringify({
        model: resolveModelForBackend('api', requestedModel),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        response_format: jsonMode ? { type: 'json_object' } : undefined,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${text.slice(0, 400)}`);
    }

    const data = await res.json();
    return {
      text: String(data?.choices?.[0]?.message?.content || '').trim(),
      sessionId: null,
      modelId: resolveModelForBackend('api', requestedModel),
      rawStdout: '',
      rawStderr: '',
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runAgentIntelligence(options) {
  const backend = getIntelligenceBackend();
  if (backend === 'claude') {
    return annotateRuntimeResult(await runClaudeTask(options), {
      backendUsed: 'claude',
      requestedBackend: backend,
    });
  }
  if (backend === 'api') {
    return annotateRuntimeResult(await runApiTextTask({
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      timeoutMs: options.timeoutMs,
      requestedModel: options.requestedModel,
      jsonMode: options.outputFormat === 'json',
    }), {
      backendUsed: 'api',
      requestedBackend: backend,
    });
  }
  try {
    return annotateRuntimeResult(await runCodexTask(options), {
      backendUsed: 'codex',
      requestedBackend: backend,
    });
  } catch (err) {
    const config = loadIntelligenceConfig();
    if (config.fallbackBackend === 'claude' && shouldFallbackFromCodex(err)) {
      return annotateRuntimeResult(await runClaudeTask({
        ...options,
        requestedModel: config.claudeModel,
      }), {
        backendUsed: 'claude',
        requestedBackend: backend,
        fallbackFrom: 'codex',
      });
    }
    throw err;
  }
}

export async function runStatelessIntelligence(options) {
  const backend = getIntelligenceBackend();
  if (backend === 'claude') {
    return annotateRuntimeResult(await runClaudeTask({
      ...options,
      maxTurns: options.maxTurns || 1,
      additionalDirs: [],
      allowedTools: options.allowedTools || null,
      outputFormat: options.outputFormat || 'text',
      sessionId: null,
    }), {
      backendUsed: 'claude',
      requestedBackend: backend,
    });
  }
  if (backend === 'api') {
    return annotateRuntimeResult(await runApiTextTask({
      systemPrompt: options.systemPrompt,
      userPrompt: options.userPrompt,
      timeoutMs: options.timeoutMs,
      requestedModel: options.requestedModel,
      jsonMode: options.outputFormat === 'json',
    }), {
      backendUsed: 'api',
      requestedBackend: backend,
    });
  }
  try {
    return annotateRuntimeResult(await runCodexTask({
      ...options,
      additionalDirs: [],
    }), {
      backendUsed: 'codex',
      requestedBackend: backend,
    });
  } catch (err) {
    const config = loadIntelligenceConfig();
    if (config.fallbackBackend === 'claude' && shouldFallbackFromCodex(err)) {
      return annotateRuntimeResult(await runClaudeTask({
        ...options,
        requestedModel: config.claudeModel,
        maxTurns: options.maxTurns || 1,
        additionalDirs: [],
        allowedTools: options.allowedTools || null,
        outputFormat: options.outputFormat || 'text',
        sessionId: null,
      }), {
        backendUsed: 'claude',
        requestedBackend: backend,
        fallbackFrom: 'codex',
      });
    }
    throw err;
  }
}
