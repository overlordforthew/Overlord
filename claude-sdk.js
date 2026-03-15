/**
 * Claude Agent SDK Integration (D1/D2)
 *
 * Wraps @anthropic-ai/claude-agent-sdk for structured streaming responses.
 * Feature-flagged via USE_CLAUDE_SDK=true in .env.
 *
 * Three exports:
 * - askClaudeSDK() — replaces CLI spawn in askClaude() for main message handling
 * - triageWithSDK() — replaces triage spawn
 * - runTaskWithSDK() — replaces runClaudeForTask() in executor
 *
 * Session persistence: chatJid->sessionId mapping in data/session-registry.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import pino from 'pino';

const logger = pino({ level: 'info' });

let ClaudeCode = null;
let sdkAvailable = false;

// Lazy-load SDK to avoid crashes when not installed
async function loadSDK() {
  if (ClaudeCode !== null) return sdkAvailable;
  try {
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    ClaudeCode = mod.ClaudeCode || mod.default;
    sdkAvailable = true;
    logger.info('Claude Agent SDK loaded successfully');
  } catch (err) {
    logger.warn({ err: err.message }, 'Claude Agent SDK not available, SDK features disabled');
    sdkAvailable = false;
  }
  return sdkAvailable;
}

// ============================================================
// SESSION REGISTRY — persistent chatJid -> sessionId mapping
// ============================================================

const SESSION_REGISTRY_PATH = './data/session-registry.json';
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

function loadSessionRegistry() {
  try {
    return JSON.parse(readFileSync(SESSION_REGISTRY_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveSessionRegistry(registry) {
  try {
    if (!existsSync(path.dirname(SESSION_REGISTRY_PATH))) {
      mkdirSync(path.dirname(SESSION_REGISTRY_PATH), { recursive: true });
    }
    writeFileSync(SESSION_REGISTRY_PATH, JSON.stringify(registry, null, 2));
  } catch { /* best effort */ }
}

function getSDKSessionId(chatJid) {
  const registry = loadSessionRegistry();
  const entry = registry[chatJid];
  if (!entry) return null;
  // Check expiry
  if (Date.now() - entry.updatedAt > SESSION_MAX_AGE_MS) {
    delete registry[chatJid];
    saveSessionRegistry(registry);
    return null;
  }
  return entry.sessionId;
}

function setSDKSessionId(chatJid, sessionId) {
  const registry = loadSessionRegistry();
  registry[chatJid] = { sessionId, updatedAt: Date.now() };
  saveSessionRegistry(registry);
}

// ============================================================
// MAIN SDK QUERY FUNCTION
// ============================================================

/**
 * Ask Claude via the Agent SDK (AsyncGenerator streaming).
 *
 * @param {object} opts
 * @param {string} opts.prompt - The full prompt to send
 * @param {string} opts.systemPrompt - System prompt
 * @param {string} opts.model - Model ID (e.g., 'claude-opus-4-6')
 * @param {string} opts.allowedTools - Comma-separated tool names
 * @param {number} opts.maxTurns - Max turns
 * @param {string} opts.cwd - Working directory
 * @param {string[]} opts.additionalDirs - Additional directories
 * @param {string} opts.chatJid - Chat JID for session tracking
 * @param {number} opts.timeoutMs - Timeout in ms
 * @param {function} opts.onProgress - Callback for streaming progress
 * @returns {Promise<{text: string, sessionId: string, modelId: string, numTurns: number}>}
 */
export async function askClaudeSDK(opts) {
  const available = await loadSDK();
  if (!available) {
    throw new Error('Claude Agent SDK not available');
  }

  const {
    prompt,
    systemPrompt,
    model = 'claude-opus-4-6',
    allowedTools,
    maxTurns = 100,
    cwd = '/projects',
    additionalDirs = [],
    chatJid,
    timeoutMs = 300000,
    onProgress,
  } = opts;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    // Build SDK options
    const queryOpts = {
      prompt,
      model,
      maxTurns,
      cwd,
      abortSignal: abortController.signal,
    };

    if (systemPrompt) queryOpts.systemPrompt = systemPrompt;
    if (allowedTools) queryOpts.allowedTools = allowedTools.split(',').map(t => t.trim());
    if (additionalDirs.length > 0) queryOpts.additionalDirectories = additionalDirs;

    // Session resume
    if (chatJid) {
      const sessionId = getSDKSessionId(chatJid);
      if (sessionId) {
        queryOpts.resume = sessionId;
      }
    }

    const claude = new ClaudeCode();
    const stream = claude.query(queryOpts);

    let resultText = '';
    let sessionId = null;
    let numTurns = 0;

    for await (const event of stream) {
      // Handle different event types
      if (event.type === 'result') {
        resultText = event.result || '';
        sessionId = event.session_id || null;
        numTurns = event.num_turns || 0;
      } else if (event.type === 'progress' || event.type === 'tool_use') {
        // Stream progress to WhatsApp via callback
        if (onProgress) {
          try { onProgress(event); } catch { /* ignore callback errors */ }
        }
      }
    }

    // Save session for continuity
    if (chatJid && sessionId) {
      setSDKSessionId(chatJid, sessionId);
    }

    return {
      text: resultText.trim() || '',
      sessionId,
      modelId: model,
      numTurns,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('SDK query timed out');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Quick triage query via SDK (lightweight, short timeout).
 */
export async function triageWithSDK({ prompt, model = 'claude-haiku-4-5', timeoutMs = 10000 }) {
  return askClaudeSDK({
    prompt,
    model,
    maxTurns: 1,
    timeoutMs,
    cwd: '/tmp',
  });
}

/**
 * Run an autonomous task via SDK (replaces runClaudeForTask).
 */
export async function runTaskWithSDK({ prompt, cwd = '/projects', timeoutMs = 600000 }) {
  return askClaudeSDK({
    prompt,
    model: 'claude-opus-4-6',
    maxTurns: 50,
    cwd,
    timeoutMs,
  });
}

export function isSDKEnabled() {
  return process.env.USE_CLAUDE_SDK === 'true';
}

export { loadSDK };
