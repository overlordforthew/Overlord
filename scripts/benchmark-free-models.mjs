#!/usr/bin/env node
/**
 * Weekly Free Model Benchmark
 *
 * Tests all OpenRouter free models for availability, speed, and code quality.
 * Writes ranked results to data/free-model-rankings.json.
 * Consumers (idle-study.js, etc.) read this file to pick the best models.
 *
 * Run: node scripts/benchmark-free-models.mjs
 * Or via scheduler cron (weekly).
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import {
  analyzeOptionalOpenRouterFailure,
  describeOptionalOpenRouterPause,
  getOptionalOpenRouterPause,
  pauseOptionalOpenRouter,
} from '../lib/optional-openrouter.js';

const RANKINGS_PATH = process.env.RANKINGS_PATH || '/app/data/free-model-rankings.json';
const KEY = process.env.OPENROUTER_KEY;

class OptionalBenchmarkSkip extends Error {}

if (!KEY) {
  console.log('[Benchmark] Skipping: OPENROUTER_KEY missing');
  process.exit(0);
}

const globalPause = getOptionalOpenRouterPause();
if (globalPause) {
  console.log(`[Benchmark] Skipping: OpenRouter paused (${describeOptionalOpenRouterPause(globalPause)})`);
  process.exit(0);
}

const CODE_PROMPT = 'Write a JavaScript function rateLimiter(maxCalls, windowMs) that implements a sliding window rate limiter. Include 3 test cases with console.log showing it works. Return ONLY the code — no markdown fences, no explanation.';
const HTML_PROMPT = 'Build a responsive card component with image placeholder, title, price, and CTA button as a single HTML file with embedded CSS. Modern design. Return ONLY the HTML — no markdown, no explanation.';
const ANALYSIS_PROMPT = 'Analyze the UX of boat marketplace listing pages. List 3 specific patterns that make listings convert better. Be concrete — name real design elements.';

const TIMEOUT_MS = 50000; // 50s per model per test

async function fetchModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { 'Authorization': `Bearer ${KEY}` },
    signal: AbortSignal.timeout(15000),
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
      pauseOptionalOpenRouter(failure.kind, failure.summary, failure.cooldownMs);
    }
    throw new OptionalBenchmarkSkip(`[Benchmark] Skipping: model catalog ${failure.summary}`);
  }
  return (data.data || [])
    .filter(m => m.id.includes(':free'))
    .map(m => ({ id: m.id, name: m.name, ctx: m.context_length, created: m.created }));
}

async function testModel(model, prompt, maxTokens = 800) {
  const start = Date.now();
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${KEY}`,
        'HTTP-Referer': 'https://namibarden.com',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
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
        pauseOptionalOpenRouter(failure.kind, failure.summary, failure.cooldownMs);
      }
      return { ok: false, ms: Date.now() - start, error: failure.summary };
    }
    let text = data.choices?.[0]?.message?.content?.trim() || '';
    // Strip thinking blocks
    text = text.replace(/^<think>[\s\S]*?<\/think>\s*/m, '').trim();
    const ms = Date.now() - start;

    if (!text || text.length < 20) {
      return { ok: false, ms, error: data.error?.message?.substring(0, 80) || 'empty response' };
    }
    return { ok: true, ms, text, chars: text.length };
  } catch (err) {
    return { ok: false, ms: Date.now() - start, error: err.message.substring(0, 60) };
  }
}

function scoreCode(text) {
  let score = 0;
  if (text.includes('function') || text.includes('=>')) score += 3;
  const testCount = (text.match(/console\.log/g) || []).length;
  score += Math.min(testCount, 5); // up to 5 points for tests
  if (text.includes('return')) score += 1;
  if (text.length > 200) score += 1;
  if (text.length > 500) score += 1;
  // Penalty for markdown fences still present
  if (text.includes('```')) score -= 1;
  return Math.max(0, Math.min(10, score));
}

function scoreHtml(text) {
  let score = 0;
  if (text.includes('<html') || text.includes('<!DOCTYPE')) score += 2;
  if (text.includes('<style') || text.includes('style=')) score += 2;
  if (text.includes('responsive') || text.includes('media') || text.includes('flex') || text.includes('grid')) score += 2;
  if (text.includes('button') || text.includes('btn')) score += 1;
  if (text.length > 300) score += 1;
  if (text.length > 800) score += 1;
  if (text.includes('```')) score -= 1;
  return Math.max(0, Math.min(10, score));
}

function scoreAnalysis(text) {
  let score = 0;
  if (text.length > 200) score += 2;
  if (text.length > 500) score += 2;
  // Look for structured thinking
  const patterns = (text.match(/\d\./g) || []).length;
  score += Math.min(patterns, 3);
  if (text.includes('convert') || text.includes('UX') || text.includes('design')) score += 1;
  if (text.length > 100 && !text.includes('```')) score += 1;
  return Math.max(0, Math.min(10, score));
}

async function benchmark() {
  console.log('[Benchmark] Fetching available free models...');
  const models = await fetchModels();
  console.log(`[Benchmark] Found ${models.length} free models. Testing...`);

  // Skip tiny models (< 4B params typically have very small context)
  const candidates = models.filter(m =>
    !m.id.includes('1.2b') && // skip liquid 1.2B
    !m.id.includes('3b-instruct') && // skip llama 3.2 3B
    m.ctx >= 8192
  );
  console.log(`[Benchmark] ${candidates.length} candidates after filtering tiny models.`);

  const results = [];

  // Test in batches of 2 to avoid rate limits
  for (let i = 0; i < candidates.length; i += 2) {
    const batch = candidates.slice(i, i + 2);
    const batchResults = await Promise.all(batch.map(async (model) => {
      const id = model.id;
      console.log(`  Testing ${id}...`);

      // Test code generation
      const code = await testModel(id, CODE_PROMPT, 800);
      // Small delay between tests for same model
      await new Promise(r => setTimeout(r, 1000));
      // Test HTML generation
      const html = await testModel(id, HTML_PROMPT, 1000);
      await new Promise(r => setTimeout(r, 1000));
      // Test analysis
      const analysis = await testModel(id, ANALYSIS_PROMPT, 600);

      const codeScore = code.ok ? scoreCode(code.text) : 0;
      const htmlScore = html.ok ? scoreHtml(html.text) : 0;
      const analysisScore = analysis.ok ? scoreAnalysis(analysis.text) : 0;

      const available = [code.ok, html.ok, analysis.ok].filter(Boolean).length;
      const avgMs = [code, html, analysis].filter(r => r.ok).reduce((s, r) => s + r.ms, 0) / (available || 1);

      // Combined score: quality (60%) + speed (20%) + reliability (20%)
      const qualityScore = (codeScore + htmlScore + analysisScore) / 3;
      const speedScore = available > 0 ? Math.max(0, 10 - avgMs / 5000) : 0; // 10 at 0s, 0 at 50s
      const reliabilityScore = (available / 3) * 10;
      const totalScore = qualityScore * 0.6 + speedScore * 0.2 + reliabilityScore * 0.2;

      console.log(`  ${id}: avail=${available}/3 quality=${qualityScore.toFixed(1)} speed=${avgMs.toFixed(0)}ms total=${totalScore.toFixed(1)}`);

      return {
        id,
        name: model.name,
        ctx: model.ctx,
        created: model.created,
        available,
        avgMs: Math.round(avgMs),
        codeScore, htmlScore, analysisScore,
        qualityScore: Math.round(qualityScore * 10) / 10,
        speedScore: Math.round(speedScore * 10) / 10,
        reliabilityScore: Math.round(reliabilityScore * 10) / 10,
        totalScore: Math.round(totalScore * 10) / 10,
        codeOk: code.ok,
        htmlOk: html.ok,
        analysisOk: analysis.ok,
        errors: [code, html, analysis].filter(r => !r.ok).map(r => r.error).filter(Boolean),
      };
    }));
    results.push(...batchResults);
    // Pause between batches
    if (i + 2 < candidates.length) await new Promise(r => setTimeout(r, 2000));
  }

  // Rank by total score
  results.sort((a, b) => b.totalScore - a.totalScore);

  // Top models = available on at least 2/3 tests, sorted by score
  const ranked = results.filter(r => r.available >= 2);
  const topModels = ranked.slice(0, 8).map(r => r.id);

  const output = {
    benchmarkDate: new Date().toISOString(),
    modelCount: models.length,
    tested: candidates.length,
    usable: ranked.length,
    topModels,
    rankings: results,
  };

  writeFileSync(RANKINGS_PATH, JSON.stringify(output, null, 2));
  console.log(`\n[Benchmark] Results written to ${RANKINGS_PATH}`);
  console.log(`[Benchmark] Top models (${ranked.length} usable):`);
  ranked.slice(0, 8).forEach((r, i) =>
    console.log(`  ${i + 1}. ${r.id.padEnd(55)} score=${r.totalScore} avail=${r.available}/3 speed=${r.avgMs}ms`)
  );

  // Check if rankings changed
  const prevPath = RANKINGS_PATH.replace('.json', '-prev.json');
  if (existsSync(RANKINGS_PATH)) {
    try {
      const prev = JSON.parse(readFileSync(prevPath, 'utf8'));
      const prevTop = prev.topModels || [];
      const changed = JSON.stringify(topModels) !== JSON.stringify(prevTop);
      if (changed) {
        console.log(`\n[Benchmark] RANKINGS CHANGED`);
        console.log(`  Previous: ${prevTop.slice(0, 4).join(', ')}`);
        console.log(`  Current:  ${topModels.slice(0, 4).join(', ')}`);
        output.changed = true;
        output.previousTop = prevTop;
      } else {
        console.log(`\n[Benchmark] Rankings unchanged.`);
        output.changed = false;
      }
    } catch { /* no previous */ }
  }

  // Save current as prev for next comparison
  try { writeFileSync(prevPath, JSON.stringify(output, null, 2)); } catch {}

  return output;
}

benchmark().catch(err => {
  if (err instanceof OptionalBenchmarkSkip) {
    console.log(err.message);
    process.exit(0);
  }
  console.error('[Benchmark] Fatal:', err.message);
  process.exit(1);
});
