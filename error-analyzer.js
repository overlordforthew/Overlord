/**
 * error-analyzer.js — AI-powered error analysis for container alerts
 *
 * Analyzes raw error logs using AI before sending WhatsApp alerts,
 * providing severity classification, root cause hypothesis, and
 * suggested remediation. Uses Haiku (fast/cheap) via SDK, with
 * OpenRouter free models as fallback.
 */

import { triageWithSDK, isSDKEnabled } from './claude-sdk.js';
import { callOpenRouter } from './router.js';
import crypto from 'crypto';

// In-memory cache: avoid re-analyzing identical errors within 15 min
const analysisCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_CACHE_SIZE = 50;

function getCacheKey(container, errorText) {
  return crypto.createHash('md5').update(`${container}:${errorText.substring(0, 300)}`).digest('hex');
}

function getCached(key) {
  const entry = analysisCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    analysisCache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key, result) {
  if (analysisCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entry
    const oldest = analysisCache.keys().next().value;
    analysisCache.delete(oldest);
  }
  analysisCache.set(key, { result, ts: Date.now() });
}

const ANALYSIS_PROMPT = `You are an infrastructure expert triaging Docker container errors.
Analyze this error and respond with ONLY a JSON object (no markdown fencing):
{
  "severity": "critical|high|medium|low",
  "rootCause": "1-2 sentence hypothesis",
  "action": "concise suggested fix",
  "noise": false
}

Rules:
- "critical": data loss, security breach, cascading failure
- "high": service down, user-facing outage
- "medium": degraded performance, non-critical errors
- "low": transient/self-healing, informational
- Set "noise" to true ONLY if the error is definitely harmless (deprecation warnings, expected restarts, known safe patterns)
- Be specific about root cause — don't just restate the error`;

/**
 * Analyze a single error with AI.
 * @param {string} container - Container/service name
 * @param {string} errorText - Raw error log excerpt
 * @returns {Promise<{severity: string, rootCause: string, action: string, noise: boolean}>}
 */
export async function analyzeError(container, errorText) {
  const cacheKey = getCacheKey(container, errorText);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const userPrompt = `Container: ${container}\nError:\n${errorText.substring(0, 500)}`;

  try {
    let raw;

    if (isSDKEnabled()) {
      try {
        raw = await triageWithSDK({
          prompt: `${ANALYSIS_PROMPT}\n\n${userPrompt}`,
          model: 'claude-haiku-4-5',
          timeoutMs: 8000,
        });
      } catch (sdkErr) {
        console.warn(`[ErrorAnalyzer] SDK failed, trying OpenRouter: ${sdkErr.message}`);
        raw = null;
      }
    }

    if (!raw) {
      // Fallback: free model via OpenRouter
      raw = await callOpenRouter(
        'stepfun/step-3.5-flash:free',
        ANALYSIS_PROMPT,
        userPrompt,
        200,
        { jsonMode: true }
      );
    }

    const result = parseAnalysis(raw);
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.warn(`[ErrorAnalyzer] All analysis paths failed: ${err.message}`);
    return fallbackAnalysis();
  }
}

/**
 * Batch-analyze multiple alerts. Runs concurrently with a concurrency cap.
 * @param {Array<{container: string, errorText: string}>} alerts
 * @returns {Promise<Array<{container: string, errorText: string, analysis: object}>>}
 */
export async function analyzeAlerts(alerts) {
  const CONCURRENCY = 3;
  const results = [];

  for (let i = 0; i < alerts.length; i += CONCURRENCY) {
    const batch = alerts.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async ({ container, errorText }) => {
        const analysis = await analyzeError(container, errorText);
        return { container, errorText, analysis };
      })
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * Format an analyzed alert for WhatsApp.
 */
export function formatAnalyzedAlert(container, errorText, analysis) {
  const severityIcon = {
    critical: '\u{1F534}', // red circle
    high: '\u{1F7E0}',     // orange circle
    medium: '\u{1F7E1}',   // yellow circle
    low: '\u{1F7E2}',      // green circle
  }[analysis.severity] || '\u{26AA}';

  return [
    `${severityIcon} *${container}* [${analysis.severity.toUpperCase()}]`,
    errorText.substring(0, 200),
    `\u{1F4CB} ${analysis.rootCause}`,
    `\u{1F527} ${analysis.action}`,
  ].join('\n');
}

/**
 * Build enriched nextAction for repair tasks.
 */
export function buildEnrichedNextAction(container, errorText, analysis, baseAction) {
  return [
    baseAction,
    '',
    `AI Analysis (${analysis.severity}):`,
    `Root cause: ${analysis.rootCause}`,
    `Suggested fix: ${analysis.action}`,
  ].join('\n');
}

function parseAnalysis(raw) {
  try {
    // Strip markdown fencing if present
    const cleaned = raw.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      severity: ['critical', 'high', 'medium', 'low'].includes(parsed.severity) ? parsed.severity : 'medium',
      rootCause: String(parsed.rootCause || 'Unable to determine').substring(0, 200),
      action: String(parsed.action || 'Review logs manually').substring(0, 200),
      noise: Boolean(parsed.noise),
    };
  } catch {
    return fallbackAnalysis();
  }
}

function fallbackAnalysis() {
  return {
    severity: 'medium',
    rootCause: 'Analysis unavailable',
    action: 'Review logs manually',
    noise: false,
  };
}
