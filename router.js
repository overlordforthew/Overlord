/**
 * Model Router for Overlord
 *
 * Three modes:
 *   ALPHA  — Opus only (current behavior, safest)
 *   BETA   — Anthropic family: Opus directs, Sonnet/Haiku handle lighter tasks
 *   CHARLIE — All models: Opus for complex, free/cheap models for everything else
 *
 * Switch with ROUTER_MODE=alpha|beta|charlie in .env
 */

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

  // ---- OpenRouter Free (direct API — no tool access) ----
  'llama-70b': {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    provider: 'openrouter',
    tier: 'mid',
    speed: 'medium',
    cost: 'free',
    strengths: 'Strong general chat, well-tested, reliable',
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
    strengths: 'Tiny and instant — perfect for classification/triage',
    via: 'openrouter-api',
  },
  'hermes-405b': {
    id: 'nousresearch/hermes-3-llama-3.1-405b:free',
    provider: 'openrouter',
    tier: 'premium',
    speed: 'slow',
    cost: 'free',
    strengths: 'Largest free model, complex reasoning, uncensored',
    via: 'openrouter-api',
  },
  'nemotron-vision': {
    id: 'nvidia/nemotron-nano-12b-v2-vl:free',
    provider: 'openrouter',
    tier: 'light',
    speed: 'fast',
    cost: 'free',
    strengths: 'Multimodal — handles images, video, text',
    via: 'openrouter-api',
  },
  'gpt-oss-120b': {
    id: 'openai/gpt-oss-120b:free',
    provider: 'openrouter',
    tier: 'mid',
    speed: 'medium',
    cost: 'free',
    strengths: 'OpenAI open-weight, good general-purpose',
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

const COMPLEX_PATTERNS = /\b(fix|debug|deploy|implement|build|create|refactor|migrate|install|configure|setup|merge|commit|push|delete|remove|update.*(?:server|config|docker|nginx|traefik)|docker|coolify|git\s|code|write.*(?:function|script|file)|edit.*(?:file|code|config)|run.*(?:test|build|deploy)|check.*(?:log|error|status))\b/i;

const MEDIUM_PATTERNS = /\b(research|compare|analyze|explain|summarize|digest|review|describe|translate|help.*(?:me|us)\s+(?:understand|figure|plan)|what.*(?:do you think|should I)|how.*(?:does|do|can|would|should)|tell me about|look up|search for)\b/i;

const SIMPLE_PATTERNS = /^(hey|hi|hello|yo|sup|thanks|thx|ok|cool|nice|yes|no|sure|nah|yep|nope|good|great|awesome|lol|haha|😂|👍|🙏|what time|what's the time|how are you|good morning|good night|gm|gn|test|ping)\b/i;

/**
 * Classify a task into complexity tiers.
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
// ROUTE DECISION
// ============================================================

/**
 * Determine which model handles a message.
 *
 * @param {object} parsed - Parsed message
 * @param {object} opts - { isAdmin, isPower, triageReason, mode }
 * @returns {{ model: object, tools: string|null, maxTurns: number|null, taskType: string, via: string, escalatable: boolean }}
 */
export function routeMessage(parsed, opts = {}) {
  const mode = opts.mode || process.env.ROUTER_MODE || 'alpha';
  const { isAdmin, isPower } = opts;
  const taskType = classifyTask(parsed, isAdmin);

  // ========== ALPHA: Everything → Opus ==========
  if (mode === 'alpha') {
    return {
      model: MODEL_REGISTRY.opus,
      tools: null,       // inherit from user role
      maxTurns: null,    // inherit from user role
      taskType,
      via: 'claude-cli',
      escalatable: false,
    };
  }

  // ========== BETA: Anthropic Family ==========
  if (mode === 'beta') {
    // Complex or admin complex → Opus (full tools)
    if (taskType === 'complex') {
      return {
        model: MODEL_REGISTRY.opus,
        tools: null,
        maxTurns: null,
        taskType,
        via: 'claude-cli',
        escalatable: false,
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
    };
  }

  // ========== CHARLIE: All Models ==========
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
      };
    }

    // Medium → Llama 70B (free, solid quality, no tools)
    if (taskType === 'medium') {
      return {
        model: MODEL_REGISTRY['llama-70b'],
        tools: null,
        maxTurns: 1,
        taskType,
        via: 'openrouter-api',
        escalatable: true,
      };
    }

    // Simple → Gemini Flash Lite (free, fastest, highest rate limits)
    return {
      model: MODEL_REGISTRY['gemini-flash-lite'],
      tools: null,
      maxTurns: 1,
      taskType,
      via: 'gemini-api',
      escalatable: true,
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
  // Charlie: free model for triage
  return { model: MODEL_REGISTRY['qwen-4b'], via: 'openrouter-api' };
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
    beta: 'Beta (Anthropic family — Opus/Sonnet/Haiku)',
    charlie: 'Charlie (All models — Opus + free/cheap)',
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
