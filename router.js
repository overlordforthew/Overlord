/**
 * Model Router for Overlord
 *
 * Three modes:
 *   ALPHA  — Opus only (current behavior, safest)
 *   BETA   — Opus directs traffic: reads every message, routes to Sonnet/Haiku
 *   CHARLIE — Opus directs traffic: reads every message, routes to free/cheap models
 *
 * In Beta/Charlie, Opus acts as the traffic director — it reads each message
 * and decides which model should handle it (complex/medium/simple).
 *
 * Switch with ROUTER_MODE=alpha|beta|charlie in .env
 */

import { spawn } from 'child_process';

// ============================================================
// MODEL REGISTRY
// ============================================================

export const MODEL_REGISTRY = {
  // ---- Anthropic (via Claude CLI — full tool access) ----
  'opus': {
    id: 'claude-opus-4-6',
    provider: 'anthropic',
    tier: 'premium',
    speed: 'medium',
    cost: '$5/$25 per Mtok',
    strengths: 'Complex reasoning, code, agentic multi-step tasks',
    via: 'claude-cli',
  },
  'sonnet': {
    id: 'claude-sonnet-4-6',
    provider: 'anthropic',
    tier: 'mid',
    speed: 'fast',
    cost: '$3/$15 per Mtok',
    strengths: 'Research, summaries, detailed Q&A, moderate code',
    via: 'claude-cli',
  },
  'haiku': {
    id: 'claude-haiku-4-5',
    provider: 'anthropic',
    tier: 'light',
    speed: 'very_fast',
    cost: '$1/$5 per Mtok',
    strengths: 'Triage, classification, simple lookups, yes/no',
    via: 'claude-cli',
  },

  // ---- OpenRouter Free: RELIABLE tier (tested working, lower rate-limit pressure) ----
  'step-flash': {
    id: 'stepfun/step-3.5-flash:free',
    provider: 'openrouter',
    tier: 'mid',
    speed: 'fast',
    cost: 'free',
    strengths: 'Fast reasoning, 256K context, reliable availability',
    via: 'openrouter-api',
  },
  'glm-air': {
    id: 'z-ai/glm-4.5-air:free',
    provider: 'openrouter',
    tier: 'mid',
    speed: 'fast',
    cost: 'free',
    strengths: 'Strong multilingual, 131K context, steady availability',
    via: 'openrouter-api',
  },
  'solar-pro': {
    id: 'upstage/solar-pro-3:free',
    provider: 'openrouter',
    tier: 'mid',
    speed: 'fast',
    cost: 'free',
    strengths: 'Good general-purpose, reliable uptime',
    via: 'openrouter-api',
  },
  'nemotron-30b': {
    id: 'nvidia/nemotron-3-nano-30b-a3b:free',
    provider: 'openrouter',
    tier: 'mid',
    speed: 'fast',
    cost: 'free',
    strengths: '30B param, 256K context, solid reasoning',
    via: 'openrouter-api',
  },
  'trinity': {
    id: 'arcee-ai/trinity-large-preview:free',
    provider: 'openrouter',
    tier: 'mid',
    speed: 'medium',
    cost: 'free',
    strengths: 'Good quality, 131K context',
    via: 'openrouter-api',
  },
  'nemotron-9b': {
    id: 'nvidia/nemotron-nano-9b-v2:free',
    provider: 'openrouter',
    tier: 'light',
    speed: 'very_fast',
    cost: 'free',
    strengths: 'Fast and light, good for simple tasks',
    via: 'openrouter-api',
  },

  // ---- OpenRouter Free: POPULAR tier (good but hit rate limits more often) ----
  'llama-70b': {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    provider: 'openrouter',
    tier: 'mid',
    speed: 'medium',
    cost: 'free',
    strengths: 'Strong general chat, well-tested',
    via: 'openrouter-api',
  },
  'mistral-small': {
    id: 'mistralai/mistral-small-3.1-24b-instruct:free',
    provider: 'openrouter',
    tier: 'light',
    speed: 'fast',
    cost: 'free',
    strengths: 'Great speed/quality ratio, multimodal',
    via: 'openrouter-api',
  },
  'qwen-coder': {
    id: 'qwen/qwen3-coder:free',
    provider: 'openrouter',
    tier: 'mid',
    speed: 'fast',
    cost: 'free',
    strengths: 'Code generation, code review, 262K context',
    via: 'openrouter-api',
  },
  'qwen-4b': {
    id: 'qwen/qwen3-4b:free',
    provider: 'openrouter',
    tier: 'light',
    speed: 'very_fast',
    cost: 'free',
    strengths: 'Tiny and instant — triage/classification',
    via: 'openrouter-api',
  },
  'hermes-405b': {
    id: 'nousresearch/hermes-3-llama-3.1-405b:free',
    provider: 'openrouter',
    tier: 'premium',
    speed: 'slow',
    cost: 'free',
    strengths: 'Largest free model, complex reasoning',
    via: 'openrouter-api',
  },

  // ---- OpenRouter Paid (cheap, good value) ----
  'deepseek': {
    id: 'deepseek/deepseek-v3.2',
    provider: 'openrouter',
    tier: 'mid',
    speed: 'fast',
    cost: '$0.25/$0.40 per Mtok',
    strengths: 'Excellent reasoning at low cost',
    via: 'openrouter-api',
  },

  // ---- Gemini Direct (free tier, via Google API) ----
  'gemini-flash': {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    tier: 'mid',
    speed: 'fast',
    cost: 'free (500 RPD)',
    strengths: 'Best free option — reasoning + speed, 1M context',
    via: 'gemini-api',
  },
  'gemini-flash-lite': {
    id: 'gemini-2.0-flash-lite',
    provider: 'gemini',
    tier: 'light',
    speed: 'very_fast',
    cost: 'free (1500 RPD)',
    strengths: 'Highest free limits, ultra-fast',
    via: 'gemini-api',
  },
};

// ============================================================
// TASK CLASSIFIER
// ============================================================

const COMPLEX_PATTERNS = /\b(fix|debug|deploy|implement|build|create|refactor|migrate|install|configure|setup|merge|commit|push|delete|remove|update.*(?:server|config|docker|nginx|traefik)|docker\s+(?:run|build|stop|start|restart|exec|compose|rm|kill|logs|pull|push|inspect|cp)|coolify|git\s|write.*(?:function|script|file)|edit.*(?:file|code|config)|run.*(?:test|build|deploy)|check.*(?:log|error|status|disk|memory|cpu|server|container|service)|disk\s*(?:usage|space)|memory\s*(?:usage|left)|cpu\s*(?:usage|load)|server\s+(?:status|health|info)|restart|uptime)\b/i;

const MEDIUM_PATTERNS = /\b(research|compare|analyze|explain|summarize|digest|review|describe|translate|help.*(?:me|us)\s+(?:understand|figure|plan)|what.*(?:do you think|should I)|how.*(?:does|do|can|would|should)|tell me about|look up|search for|what(?:'s| is) the (?:disk|memory|cpu|status|uptime))\b/i;

const SIMPLE_PATTERNS = /^(hey|hi|hello|yo|sup|thanks|thx|ok|cool|nice|yes|no|sure|nah|yep|nope|good|great|awesome|lol|haha|😂|👍|🙏|what time|what's the time|how are you|good morning|good night|gm|gn|test|ping)\b/i;

/**
 * Fast regex classifier (used as fallback and fast-path for obvious cases).
 * Returns: 'complex' | 'medium' | 'simple'
 */
export function classifyTask(parsed, isAdmin) {
  const text = (parsed.text || '').trim();
  const hasMedia = parsed.hasMedia;

  // Empty or very short → simple
  if (!text && !hasMedia) return 'simple';

  // Media with instructions → medium; media alone → medium (needs analysis)
  if (hasMedia && text && COMPLEX_PATTERNS.test(text)) return 'complex';
  if (hasMedia) return 'medium';

  // Keyword-based classification
  if (COMPLEX_PATTERNS.test(text)) return 'complex';
  if (SIMPLE_PATTERNS.test(text)) return 'simple';
  if (MEDIUM_PATTERNS.test(text)) return 'medium';

  // Length heuristics
  if (text.length > 200) return 'complex';
  if (text.length < 40) return 'simple';

  // Multi-sentence → likely medium+
  const sentences = (text.match(/[.!?]+/g) || []).length;
  if (sentences > 3) return 'medium';

  // Admin defaults higher, others default lower
  return isAdmin ? 'medium' : 'simple';
}

// ============================================================
// OPUS-DIRECTED CLASSIFICATION (Beta/Charlie)
// ============================================================

/**
 * Have Opus read the message and classify its complexity.
 * Opus acts as the traffic director — smarter than regex, understands nuance.
 *
 * Fast-path: obvious cases (empty, greetings, clear commands) skip the Opus call.
 * Fallback: if Opus call fails, falls back to regex classifier.
 *
 * @param {object} parsed - Parsed message
 * @param {boolean} isAdmin - Whether the sender is admin
 * @returns {Promise<'complex'|'medium'|'simple'>}
 */
export async function classifyWithOpus(parsed, isAdmin) {
  const text = (parsed.text || '').trim();
  const hasMedia = parsed.hasMedia;

  // Fast-path: don't burn an Opus call for obvious cases
  if (!text && !hasMedia) return 'simple';
  if (!text && hasMedia) return 'medium';
  if (SIMPLE_PATTERNS.test(text) && !hasMedia) return 'simple';

  // Everything else: ask Opus to classify
  const classifyPrompt = `You are a message classifier for a WhatsApp AI assistant. Classify the following message into exactly one category:

COMPLEX — Requires server access, code changes, Docker commands, debugging, deployments, multi-step tasks, or deep reasoning. Examples: "fix the nginx config", "deploy beastmode", "check why the API is down", "write a script to backup the database"

MEDIUM — Requires research, analysis, explanation, comparison, or thoughtful response. Examples: "explain how kubernetes works", "what do you think about this approach", "summarize this article", "translate this to Spanish"

SIMPLE — Casual conversation, greetings, acknowledgments, quick factual lookups, or brief responses. Examples: "hey", "thanks", "what time is it", "how are you", "cool"

${hasMedia ? '[Message includes media attachment (image/video/audio/document)]' : ''}
${isAdmin ? '[Sender is admin with full server access]' : '[Sender is a regular user]'}

Message: "${text.substring(0, 500)}"

Reply with ONLY one word: COMPLEX, MEDIUM, or SIMPLE`;

  try {
    const classification = await new Promise((resolve, reject) => {
      let out = '';
      const proc = spawn(process.env.CLAUDE_PATH || 'claude', [
        '-p', '--output-format', 'text', '--max-turns', '1',
        '--model', 'claude-opus-4-6',
      ], { timeout: 15_000, env: { ...process.env, TERM: 'dumb' } });
      proc.stdin.write(classifyPrompt);
      proc.stdin.end();
      proc.stdout.on('data', (d) => { out += d; });
      proc.on('close', (code) => {
        if (code === 0) resolve(out.trim());
        else reject(new Error(`Opus classify exited ${code}`));
      });
      proc.on('error', reject);
    });

    // Parse Opus response — extract the classification word
    const cleaned = classification.toUpperCase().trim();
    if (cleaned.includes('COMPLEX')) return 'complex';
    if (cleaned.includes('MEDIUM')) return 'medium';
    if (cleaned.includes('SIMPLE')) return 'simple';

    // Opus gave an unexpected response — fall back to regex
    console.warn(`[Router] Opus classification unclear: "${classification.substring(0, 100)}" — falling back to regex`);
    return classifyTask(parsed, isAdmin);
  } catch (err) {
    // Opus call failed — fall back to regex classifier
    console.warn(`[Router] Opus classification failed: ${err.message} — falling back to regex`);
    return classifyTask(parsed, isAdmin);
  }
}

// ============================================================
// ROUTE DECISION
// ============================================================

/**
 * Determine which model handles a message.
 *
 * In Beta/Charlie modes, Opus reads the message first and decides the complexity
 * tier (complex/medium/simple), then routes to the appropriate model.
 * In Alpha mode, everything goes to Opus anyway, so regex classifier is fine.
 *
 * @param {object} parsed - Parsed message
 * @param {object} opts - { isAdmin, isPower, triageReason, mode }
 * @returns {Promise<{ model: object, tools: string|null, maxTurns: number|null, taskType: string, via: string, escalatable: boolean, classifiedBy: string }>}
 */
export async function routeMessage(parsed, opts = {}) {
  const mode = opts.mode || process.env.ROUTER_MODE || 'alpha';
  const { isAdmin, isPower } = opts;

  // Power users always get Opus — they need full tool access for code edits
  if (isPower) {
    const taskType = mode === 'alpha' ? classifyTask(parsed, isAdmin) : await classifyWithOpus(parsed, isAdmin);
    return {
      model: MODEL_REGISTRY.opus,
      tools: null,
      maxTurns: null,
      taskType,
      via: 'claude-cli',
      escalatable: false,
      classifiedBy: mode === 'alpha' ? 'regex' : 'opus',
    };
  }

  // Alpha uses regex (Opus handles everything anyway — no routing decision needed)
  // Beta/Charlie use Opus-directed classification
  let taskType;
  let classifiedBy;
  if (mode === 'alpha') {
    taskType = classifyTask(parsed, isAdmin);
    classifiedBy = 'regex';
  } else {
    taskType = await classifyWithOpus(parsed, isAdmin);
    classifiedBy = 'opus';
  }

  // ========== ALPHA: Everything → Opus ==========
  if (mode === 'alpha') {
    return {
      model: MODEL_REGISTRY.opus,
      tools: null,       // inherit from user role
      maxTurns: null,    // inherit from user role
      taskType,
      via: 'claude-cli',
      escalatable: false,
      classifiedBy,
    };
  }

  // ========== BETA: Opus directs → Anthropic Family ==========
  if (mode === 'beta') {
    // Complex → Opus (full tools)
    if (taskType === 'complex') {
      return {
        model: MODEL_REGISTRY.opus,
        tools: null,
        maxTurns: null,
        taskType,
        via: 'claude-cli',
        escalatable: false,
        classifiedBy,
      };
    }

    // Medium → Sonnet (scoped tools)
    if (taskType === 'medium') {
      return {
        model: MODEL_REGISTRY.sonnet,
        tools: isAdmin ? null : (isPower ? 'Read,Write,Edit,Bash,Glob,Grep,WebSearch,WebFetch' : 'Read,WebSearch,WebFetch'),
        maxTurns: isAdmin ? 50 : 30,
        taskType,
        via: 'claude-cli',
        escalatable: true,
        classifiedBy,
      };
    }

    // Simple → Haiku (minimal tools)
    return {
      model: MODEL_REGISTRY.haiku,
      tools: isAdmin ? 'Read,Glob,Grep,WebSearch,WebFetch' : 'Read,WebSearch,WebFetch',
      maxTurns: 5,
      taskType,
      via: 'claude-cli',
      escalatable: true,
      classifiedBy,
    };
  }

  // ========== CHARLIE: Opus directs → All Models ==========
  if (mode === 'charlie') {
    // Complex → Opus via Claude CLI (needs tools)
    if (taskType === 'complex') {
      return {
        model: MODEL_REGISTRY.opus,
        tools: null,
        maxTurns: null,
        taskType,
        via: 'claude-cli',
        escalatable: false,
        classifiedBy,
      };
    }

    // Medium → Step Flash (free, fast, reliable, 256K context)
    if (taskType === 'medium') {
      return {
        model: MODEL_REGISTRY['step-flash'],
        tools: null,
        maxTurns: 1,
        taskType,
        via: 'openrouter-api',
        escalatable: true,
        classifiedBy,
      };
    }

    // Simple → Nemotron 9B (free, very fast, reliable)
    return {
      model: MODEL_REGISTRY['nemotron-9b'],
      tools: null,
      maxTurns: 1,
      taskType,
      via: 'openrouter-api',
      escalatable: true,
      classifiedBy,
    };
  }

  // Fallback → Opus
  return {
    model: MODEL_REGISTRY.opus,
    tools: null,
    maxTurns: null,
    taskType,
    via: 'claude-cli',
    escalatable: false,
    classifiedBy: 'regex',
  };
}

/**
 * Determine which model handles triage (YES/NO group chat decisions).
 * Triage is a simple classification task — no tools needed.
 */
export function routeTriage(mode) {
  const currentMode = mode || process.env.ROUTER_MODE || 'alpha';

  if (currentMode === 'alpha') {
    return { model: MODEL_REGISTRY.opus, via: 'claude-cli' };
  }
  if (currentMode === 'beta') {
    return { model: MODEL_REGISTRY.haiku, via: 'claude-cli' };
  }
  // Charlie: fast reliable free model for triage
  return { model: MODEL_REGISTRY['nemotron-9b'], via: 'openrouter-api' };
}

// ============================================================
// FREE MODEL FALLBACK CHAINS (try multiple before Opus)
// ============================================================

/**
 * Ordered fallback chains for free models.
 * When one model 429s, try the next in the chain before escalating to Opus.
 */
export const FREE_FALLBACK_CHAINS = {
  simple: ['nemotron-9b', 'glm-air', 'solar-pro', 'mistral-small', 'gemini-flash-lite', 'qwen-4b'],
  medium: ['step-flash', 'glm-air', 'trinity', 'solar-pro', 'nemotron-30b', 'llama-70b', 'gemini-flash'],
};

/**
 * Try calling free models in order. Returns { response, modelUsed } or throws if all fail.
 */
export async function callWithFallback(chain, systemPrompt, userPrompt, maxTokens = 2000) {
  const errors = [];
  for (const modelKey of chain) {
    const model = MODEL_REGISTRY[modelKey];
    if (!model) continue;
    try {
      const caller = model.via === 'gemini-api' ? callGemini : callOpenRouter;
      const response = await caller(model.id, systemPrompt, userPrompt, maxTokens);
      return { response, modelUsed: model };
    } catch (err) {
      errors.push(`${modelKey}: ${err.message}`);
      // Continue to next model in chain
    }
  }
  throw new Error(`All free models failed: ${errors.join(' | ')}`);
}

// ============================================================
// API CALLERS (for non-Claude models)
// ============================================================

/**
 * Call OpenRouter API directly (text in → text out, no tools).
 */
export async function callOpenRouter(modelId, systemPrompt, userPrompt, maxTokens = 2000) {
  const key = process.env.OPENROUTER_KEY;
  if (!key) throw new Error('OPENROUTER_KEY not set');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': 'https://overlord.bot',
      'X-Title': 'Overlord WhatsApp Bot',
    },
    body: JSON.stringify({
      model: modelId,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: maxTokens,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenRouter ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();

  // Check for rate limit or error in response body
  if (data.error) {
    throw new Error(`OpenRouter error: ${data.error.message || JSON.stringify(data.error).substring(0, 200)}`);
  }

  return data.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Call Google Gemini API directly.
 */
export async function callGemini(modelId, systemPrompt, userPrompt, maxTokens = 2000) {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('GOOGLE_API_KEY not set');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
      signal: AbortSignal.timeout(45_000),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${errText.substring(0, 200)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

// ============================================================
// ESCALATION DETECTION
// ============================================================

const HEDGING_PATTERNS = /\b(I'm not sure|I think maybe|I cannot|I don't have access|I can't help with|beyond my (?:scope|capabilities)|you (?:might|may) (?:need|want) to|I'd recommend asking|ESCALATE)\b/i;

/**
 * Check if a response from a smaller model should be escalated to Opus.
 * Returns true if the response shows signs of struggling.
 */
export function shouldEscalate(response, taskType) {
  if (!response) return true;

  // Explicit escalation request
  if (/\bESCALATE\b/.test(response)) return true;

  // Empty or very short response for non-simple tasks
  if (taskType !== 'simple' && response.length < 20) return true;

  // Hedging language on medium tasks
  if (taskType === 'medium' && HEDGING_PATTERNS.test(response)) return true;

  // Overly long response = struggling (for simple tasks)
  if (taskType === 'simple' && response.length > 1500) return true;

  // Error indicators
  if (/\b(error|exception|failed|cannot process)\b/i.test(response) && response.length < 100) return true;

  return false;
}

// ============================================================
// UTILITY
// ============================================================

/**
 * Get a human-readable summary of the current routing config.
 */
export function getRouterStatus() {
  const mode = process.env.ROUTER_MODE || 'alpha';
  const modeNames = {
    alpha: 'Alpha (Opus only)',
    beta: 'Beta (Opus directs → Sonnet/Haiku)',
    charlie: 'Charlie (Opus directs → free/cheap models)',
  };

  return {
    mode,
    modeName: modeNames[mode] || `Unknown (${mode})`,
    registry: Object.entries(MODEL_REGISTRY).map(([key, m]) => ({
      key,
      id: m.id,
      provider: m.provider,
      tier: m.tier,
      cost: m.cost,
      via: m.via,
    })),
  };
}
