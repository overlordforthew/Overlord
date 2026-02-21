/**
 * WhatsApp ↔ Claude Code Bridge v2.0
 * 
 * Sophisticated bridge that connects WhatsApp to Claude CLI.
 * 
 * Features:
 * - Handles ALL message types: text, images, video, audio, documents, stickers, contacts, location
 * - Downloads and passes media to Claude for analysis
 * - Intelligent auto-response: reads all messages, decides when to chime in
 * - Rolling conversation context per chat (remembers recent messages even if it didn't respond)
 * - Per-contact persistent memory (memory.md)
 * - Group chat awareness with smart participation
 * - Message quoting/reply context
 * - Admin vs regular user permissions
 * - Voice message transcription support
 * - Reaction support
 * - Multi-message batching (waits for rapid-fire messages before responding)
 */

import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  downloadMediaMessage,
  getContentType,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import crypto from 'crypto';

const execAsync = promisify(exec);

// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
  // Your WhatsApp number (country code + number, no + or spaces)
  adminNumber: process.env.ADMIN_NUMBER || '18681234567',

  // Bot identity
  botName: process.env.BOT_NAME || 'Claude',

  // Directories
  authDir: './auth',
  dataDir: './data',
  logsDir: './logs',
  mediaDir: './media',

  // Claude CLI
  claudePath: process.env.CLAUDE_PATH || 'claude',
  claudeModel: process.env.CLAUDE_MODEL || '',
  maxResponseTime: 180_000,  // 3 min for media analysis

  // ---- RESPONSE BEHAVIOR ----
  // Mode: 'all' = respond to every message
  //        'smart' = Claude decides when to respond (uses a quick triage call)
  //        'mention' = only when mentioned/triggered
  responseMode: process.env.RESPONSE_MODE || 'smart',

  // For 'smart' mode: how often to chime in unprompted (0.0 - 1.0)
  // 0.3 = ~30% of messages get a response, higher = more chatty
  chimeInThreshold: parseFloat(process.env.CHIME_THRESHOLD || '0.5'),

  // DMs always get a response regardless of mode
  alwaysRespondToDMs: true,

  // Group behavior
  respondToGroups: true,
  groupTriggerWords: ['claude', 'bot', 'ai', 'hey claude'],

  // Message batching: wait this long for more messages before responding
  batchWindowMs: 2000,

  // Rolling context: how many recent messages to keep per chat
  contextWindowSize: 50,

  // Typing indicator
  typingIndicator: true,
  readReceipts: true,

  // Rate limiting
  maxMessagesPerMinute: 15,
  cooldownMessage: '⏳ Give me a moment to catch up...',

  // Media settings
  maxMediaSizeMB: 25,
  supportedImageTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  supportedDocTypes: ['application/pdf', 'text/plain', 'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
};

// ============================================================
// LOGGER
// ============================================================
const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// ============================================================
// HELPERS
// ============================================================

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function contactDir(jid) {
  const sanitized = jid.replace(/[^a-zA-Z0-9]/g, '_');
  const dir = path.join(CONFIG.dataDir, sanitized);
  ensureDir(dir);
  return dir;
}

function mediaPathFor(jid) {
  const dir = path.join(contactDir(jid), 'media');
  ensureDir(dir);
  return dir;
}

function isAdmin(jid) {
  return jid.includes(CONFIG.adminNumber);
}

function isGroup(jid) {
  return jid.endsWith('@g.us');
}

function senderNumber(jid) {
  return jid.split('@')[0].split(':')[0];
}

function now() {
  return new Date().toISOString();
}

function generateId() {
  return crypto.randomBytes(8).toString('hex');
}

// ============================================================
// CONVERSATION CONTEXT MANAGER
// ============================================================
/**
 * Maintains a rolling window of recent messages per chat.
 * Gives Claude full conversational context even for messages
 * it didn't respond to.
 */
class ConversationContext {
  constructor() {
    this.contexts = new Map();
  }

  add(chatJid, entry) {
    if (!this.contexts.has(chatJid)) {
      this.contexts.set(chatJid, []);
    }
    const ctx = this.contexts.get(chatJid);
    ctx.push({ timestamp: now(), ...entry });
    while (ctx.length > CONFIG.contextWindowSize) ctx.shift();
  }

  get(chatJid, limit = CONFIG.contextWindowSize) {
    return (this.contexts.get(chatJid) || []).slice(-limit);
  }

  format(chatJid, limit = 30) {
    const messages = this.get(chatJid, limit);
    if (messages.length === 0) return '[No recent messages]';

    return messages.map(m => {
      let who = m.role === 'bot' ? `🤖 ${CONFIG.botName}` : (m.senderName || m.sender);
      let line = `[${m.timestamp}] ${who}`;

      switch (m.type) {
        case 'text':
          line += `: ${m.text}`; break;
        case 'image':
          line += `: [📷 Image${m.caption ? ': ' + m.caption : ''}]${m.filePath ? ' (file: ' + m.filePath + ')' : ''}`; break;
        case 'video':
          line += `: [🎥 Video${m.caption ? ': ' + m.caption : ''}]`; break;
        case 'audio': case 'ptt':
          line += `: [🎤 Voice message]${m.filePath ? ' (file: ' + m.filePath + ')' : ''}`; break;
        case 'document':
          line += `: [📄 ${m.fileName || 'Document'}]${m.filePath ? ' (file: ' + m.filePath + ')' : ''}`; break;
        case 'sticker':
          line += `: [🎨 Sticker]`; break;
        case 'location':
          line += `: [📍 ${m.locationName || `${m.latitude}, ${m.longitude}`}]`; break;
        case 'contact':
          line += `: [👤 Contact: ${m.contactName}]`; break;
        case 'reaction':
          line += `: [reacted ${m.emoji}]`; break;
        default:
          line += `: [${m.type}]`; break;
      }

      if (m.quotedText) {
        line = `  ↩️ replying to: "${m.quotedText.substring(0, 80)}" — ` + line;
      }
      return line;
    }).join('\n');
  }
}

const conversationContext = new ConversationContext();

// ============================================================
// MEMORY MANAGER
// ============================================================

async function getMemory(jid) {
  const memPath = path.join(contactDir(jid), 'memory.md');
  try {
    return await fs.readFile(memPath, 'utf-8');
  } catch {
    const initial = `# Memory for ${senderNumber(jid)}\n\nCreated: ${now()}\n\n## Key Facts\n_Nothing yet._\n\n## Preferences\n_Nothing yet._\n\n## Notes\n_Nothing yet._\n`;
    await fs.writeFile(memPath, initial);
    return initial;
  }
}

// ============================================================
// SESSION MANAGER
// ============================================================

async function getSessionId(jid) {
  try {
    return (await fs.readFile(path.join(contactDir(jid), 'session_id'), 'utf-8')).trim();
  } catch { return null; }
}

async function saveSessionId(jid, sessionId) {
  if (sessionId) await fs.writeFile(path.join(contactDir(jid), 'session_id'), sessionId);
}

// ============================================================
// CONVERSATION LOGGER
// ============================================================

async function logMessage(chatJid, senderJid, role, content) {
  ensureDir(CONFIG.logsDir);
  const entry = JSON.stringify({
    t: now(), chat: senderNumber(chatJid), sender: senderNumber(senderJid), role,
    content: typeof content === 'string' ? content : JSON.stringify(content),
  });
  await fs.appendFile(path.join(CONFIG.logsDir, `${senderNumber(chatJid)}.jsonl`), entry + '\n');
}

// ============================================================
// MEDIA HANDLER
// ============================================================

/**
 * Download and save media from a WhatsApp message.
 * Supports images, videos, audio, voice notes, documents, stickers.
 */
async function handleMedia(msg, chatJid, sock) {
  try {
    const msgType = getContentType(msg.message);
    if (!msgType) return null;

    const mediaMsg = msg.message[msgType];
    if (!mediaMsg) return null;

    const mimeType = mediaMsg.mimetype || '';
    const fileSize = mediaMsg.fileLength ? Number(mediaMsg.fileLength) : 0;

    if (fileSize > CONFIG.maxMediaSizeMB * 1024 * 1024) {
      return { skipped: true, reason: 'too_large', mimeType, fileSize };
    }

    // Determine extension
    const extMap = {
      'jpeg': 'jpg', 'jpg': 'jpg', 'png': 'png', 'webp': 'webp', 'gif': 'gif',
      'mp4': 'mp4', 'webm': 'webm', 'ogg': 'ogg', 'opus': 'ogg', 'mpeg': 'mp3',
      'mp3': 'mp3', 'pdf': 'pdf', 'msword': 'doc', 'wordprocessing': 'docx',
      'spreadsheet': 'xlsx', 'excel': 'xlsx', 'csv': 'csv', 'plain': 'txt',
    };
    let ext = 'bin';
    for (const [key, val] of Object.entries(extMap)) {
      if (mimeType.includes(key)) { ext = val; break; }
    }

    const fileName = mediaMsg.fileName || `${msgType.replace('Message', '')}_${generateId()}.${ext}`;
    const filePath = path.join(mediaPathFor(chatJid), `${Date.now()}_${fileName}`);

    const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
      logger: pino({ level: 'silent' }),
      reuploadRequest: sock.updateMediaMessage,
    });

    if (buffer) {
      await fs.writeFile(filePath, buffer);
      logger.info({ filePath, mimeType, size: buffer.length }, '📎 Media saved');
      return { filePath, mimeType, fileName, size: buffer.length };
    }
    return null;
  } catch (err) {
    logger.error({ err }, 'Failed to download media');
    return { skipped: true, reason: 'download_error', error: err.message };
  }
}

// ============================================================
// MESSAGE PARSER
// ============================================================

/**
 * Parse any WhatsApp message into a structured format.
 */
function parseMessage(msg) {
  const msgType = getContentType(msg.message);
  if (!msgType) return null;

  const parsed = {
    id: msg.key.id,
    type: null,
    text: null,
    caption: null,
    mimeType: null,
    fileName: null,
    quotedText: null,
    hasMedia: false,
    raw: msg,
  };

  // Extract reply/quote context
  const contextInfo = msg.message[msgType]?.contextInfo;
  if (contextInfo?.quotedMessage) {
    const qType = getContentType(contextInfo.quotedMessage);
    if (qType) {
      parsed.quotedText =
        contextInfo.quotedMessage?.conversation ||
        contextInfo.quotedMessage?.extendedTextMessage?.text ||
        contextInfo.quotedMessage?.[qType]?.caption ||
        `[${qType}]`;
    }
    // Check if replying to the bot
    parsed.replyingToBot = contextInfo.participant?.includes(CONFIG.adminNumber) || false;
  }

  switch (msgType) {
    case 'conversation':
      parsed.type = 'text';
      parsed.text = msg.message.conversation;
      break;
    case 'extendedTextMessage':
      parsed.type = 'text';
      parsed.text = msg.message.extendedTextMessage.text;
      break;
    case 'imageMessage':
      parsed.type = 'image';
      parsed.hasMedia = true;
      parsed.caption = msg.message.imageMessage.caption || null;
      parsed.mimeType = msg.message.imageMessage.mimetype;
      parsed.text = parsed.caption;
      break;
    case 'videoMessage':
      parsed.type = 'video';
      parsed.hasMedia = true;
      parsed.caption = msg.message.videoMessage.caption || null;
      parsed.mimeType = msg.message.videoMessage.mimetype;
      parsed.text = parsed.caption;
      break;
    case 'audioMessage':
      parsed.type = msg.message.audioMessage.ptt ? 'ptt' : 'audio';
      parsed.hasMedia = true;
      parsed.mimeType = msg.message.audioMessage.mimetype;
      break;
    case 'documentMessage':
    case 'documentWithCaptionMessage': {
      parsed.type = 'document';
      parsed.hasMedia = true;
      const doc = msg.message.documentMessage || msg.message.documentWithCaptionMessage?.message?.documentMessage;
      parsed.fileName = doc?.fileName || 'document';
      parsed.caption = doc?.caption || null;
      parsed.mimeType = doc?.mimetype;
      parsed.text = parsed.caption;
      break;
    }
    case 'stickerMessage':
      parsed.type = 'sticker';
      parsed.hasMedia = true;
      parsed.mimeType = msg.message.stickerMessage.mimetype;
      break;
    case 'contactMessage':
    case 'contactsArrayMessage':
      parsed.type = 'contact';
      parsed.contactName = msg.message.contactMessage?.displayName ||
        msg.message.contactsArrayMessage?.contacts?.[0]?.displayName || 'Unknown';
      parsed.text = `Shared contact: ${parsed.contactName}`;
      break;
    case 'locationMessage':
    case 'liveLocationMessage': {
      parsed.type = 'location';
      const loc = msg.message.locationMessage || msg.message.liveLocationMessage;
      parsed.latitude = loc?.degreesLatitude;
      parsed.longitude = loc?.degreesLongitude;
      parsed.locationName = loc?.name || loc?.address || null;
      parsed.text = `Location: ${parsed.latitude}, ${parsed.longitude}${parsed.locationName ? ' - ' + parsed.locationName : ''}`;
      break;
    }
    case 'reactionMessage':
      parsed.type = 'reaction';
      parsed.emoji = msg.message.reactionMessage.text;
      parsed.text = `Reacted with ${parsed.emoji}`;
      break;
    case 'pollCreationMessage':
    case 'pollCreationMessageV3': {
      parsed.type = 'poll';
      const poll = msg.message.pollCreationMessage || msg.message.pollCreationMessageV3;
      parsed.text = `Poll: ${poll?.name} — ${poll?.options?.map(o => o.optionName).join(', ')}`;
      break;
    }
    default:
      parsed.type = msgType.replace('Message', '');
      parsed.text = `[${parsed.type} message]`;
      break;
  }

  return parsed;
}

// ============================================================
// SMART RESPONSE TRIAGE
// ============================================================

/**
 * Quick triage: should the bot respond to this message?
 * Uses a fast Claude call for 'smart' mode.
 */
async function shouldRespondSmart(parsed, chatJid, senderJid) {
  // DMs always get a response
  if (!isGroup(chatJid) && CONFIG.alwaysRespondToDMs) {
    return { shouldRespond: true, reason: 'direct_message' };
  }

  // Direct mentions always trigger
  const text = (parsed.text || '').toLowerCase();
  if (CONFIG.groupTriggerWords.some(w => text.includes(w))) {
    return { shouldRespond: true, reason: 'mentioned_by_name' };
  }

  // Replies to bot's messages always trigger
  if (parsed.replyingToBot) {
    return { shouldRespond: true, reason: 'reply_to_bot' };
  }

  // Questions directed at nobody specific (good opportunity to help)
  const looksLikeQuestion = /\?$/.test(text.trim()) || /^(what|how|why|when|where|who|can|does|is|are|do|should|would|could)\b/i.test(text.trim());

  // Media shared without context (opportunity to analyze)
  const mediaShared = parsed.hasMedia && !parsed.text;

  // For 'all' mode
  if (CONFIG.responseMode === 'all') {
    return { shouldRespond: true, reason: 'all_mode' };
  }

  // For 'mention' mode
  if (CONFIG.responseMode === 'mention') {
    return { shouldRespond: false, reason: 'not_mentioned' };
  }

  // ---- SMART MODE ----
  // Fast heuristics first (avoid Claude call when possible)
  if (looksLikeQuestion) {
    return { shouldRespond: true, reason: 'unanswered_question' };
  }

  if (mediaShared) {
    return { shouldRespond: true, reason: 'media_shared_no_context' };
  }

  // For everything else, ask Claude to decide
  const recentContext = conversationContext.format(chatJid, 12);

  const triagePrompt = `You are deciding whether to respond in a WhatsApp group chat as "${CONFIG.botName}".

RESPOND YES if:
- Someone asks a question you can answer
- You have genuinely useful input on the topic
- Someone shares something interesting worth commenting on
- The chat could use your knowledge or humor
- Someone seems confused or needs help

RESPOND NO if:
- People are having casual banter that doesn't need you
- Message is just "ok", "lol", "👍", emoji reactions, etc.
- It's a personal conversation between specific people
- You'd just be restating what someone said
- Your input would feel intrusive

Recent chat:
${recentContext}

Latest message: ${parsed.text || `[${parsed.type}]`}

Reply ONLY: YES or NO`;

  try {
    const { stdout } = await execAsync(
      `echo ${JSON.stringify(triagePrompt)} | ${CONFIG.claudePath} -p --output-format text --max-turns 1`,
      { timeout: 15_000, env: { ...process.env, TERM: 'dumb' } }
    );

    const answer = stdout.trim().toUpperCase();
    if (answer.includes('YES')) {
      return { shouldRespond: true, reason: 'smart_triage_yes' };
    }
    if (answer.includes('NO')) {
      return { shouldRespond: false, reason: 'smart_triage_no' };
    }

    // Fallback to threshold
    return {
      shouldRespond: Math.random() < CONFIG.chimeInThreshold,
      reason: 'smart_triage_unclear',
    };
  } catch (err) {
    logger.warn({ err: err.message }, 'Triage call failed');
    return {
      shouldRespond: Math.random() < CONFIG.chimeInThreshold,
      reason: 'triage_error_fallback',
    };
  }
}

// ============================================================
// CLAUDE CLI INTEGRATION
// ============================================================

/**
 * Send a message with full context to Claude CLI.
 * Supports media file references for image/document analysis.
 */
async function askClaude(chatJid, senderJid, parsed, mediaResult, triageReason) {
  const cDir = contactDir(chatJid);
  const isAdminUser = isAdmin(senderJid);
  const memory = await getMemory(chatJid);
  const recentContext = conversationContext.format(chatJid, 30);
  const sessionId = await getSessionId(chatJid);

  // Build comprehensive prompt
  const prompt = [];

  prompt.push(`[SYSTEM CONTEXT]`);
  prompt.push(`You are "${CONFIG.botName}", an AI participant in a WhatsApp chat.`);
  prompt.push(`Time: ${now()}`);
  prompt.push(`Chat: ${isGroup(chatJid) ? 'Group' : 'DM'} | Sender: ${senderNumber(senderJid)}${isAdminUser ? ' (ADMIN)' : ''}`);
  prompt.push(`Trigger: ${triageReason}`);
  prompt.push('');

  prompt.push(`[MEMORY]`);
  prompt.push(memory);
  prompt.push('');

  prompt.push(`[RECENT CONVERSATION]`);
  prompt.push(recentContext);
  prompt.push('');

  prompt.push(`[CURRENT MESSAGE]`);
  if (parsed.quotedText) prompt.push(`↩️ Replying to: "${parsed.quotedText}"`);
  if (parsed.text) prompt.push(parsed.text);
  if (!parsed.text && parsed.type !== 'text') prompt.push(`[${parsed.type} message received]`);

  // Media instructions
  if (mediaResult && !mediaResult.skipped) {
    prompt.push('');
    prompt.push(`[ATTACHED FILE]`);
    prompt.push(`Type: ${parsed.type} (${mediaResult.mimeType})`);
    prompt.push(`Path: ${mediaResult.filePath}`);
    prompt.push(`Size: ${(mediaResult.size / 1024).toFixed(1)} KB`);
    if (parsed.fileName) prompt.push(`Name: ${parsed.fileName}`);

    // Specific instructions based on media type
    if (CONFIG.supportedImageTypes.some(t => mediaResult.mimeType?.includes(t.split('/')[1]))) {
      prompt.push(`\n→ This is an IMAGE. Read it with: @${mediaResult.filePath}`);
      prompt.push(`→ Describe what you see. If there's text, read it. If it's a screenshot, analyze it.`);
    } else if (mediaResult.mimeType?.includes('pdf')) {
      prompt.push(`\n→ This is a PDF. Read it with: @${mediaResult.filePath}`);
      prompt.push(`→ Summarize the key contents.`);
    } else if (mediaResult.mimeType?.includes('audio') || mediaResult.mimeType?.includes('ogg') || mediaResult.mimeType?.includes('opus')) {
      prompt.push(`\n→ This is a VOICE NOTE / AUDIO file. You cannot listen to audio files directly.`);
      prompt.push(`→ Acknowledge you received a voice message but can't transcribe it yet.`);
    } else if (['csv', 'plain', 'txt'].some(t => mediaResult.mimeType?.includes(t))) {
      prompt.push(`\n→ This is a TEXT/DATA file. Read it with: @${mediaResult.filePath}`);
    } else if (['wordprocessing', 'spreadsheet', 'docx', 'xlsx'].some(t => mediaResult.mimeType?.includes(t))) {
      prompt.push(`\n→ This is a DOCUMENT. Try reading with: @${mediaResult.filePath}`);
    }
  } else if (mediaResult?.skipped) {
    prompt.push(`\n[MEDIA NOT AVAILABLE: ${mediaResult.reason}]`);
  }

  // Location
  if (parsed.type === 'location') {
    prompt.push(`\n📍 Coordinates: ${parsed.latitude}, ${parsed.longitude}`);
    if (parsed.locationName) prompt.push(`📍 Name: ${parsed.locationName}`);
    prompt.push(`→ You can look up this location or provide info about the area.`);
  }

  // Response guidelines
  prompt.push('');
  prompt.push(`[INSTRUCTIONS]`);
  prompt.push(`- WhatsApp-friendly: concise, plain text, no markdown headers`);
  prompt.push(`- Be natural and conversational, not robotic`);
  prompt.push(`- If you learn something important about this person, update memory.md`);
  prompt.push(`- If unsolicited (smart triage), keep it brief and add genuine value`);
  prompt.push(`- For images/docs: analyze the content, be specific about what you see`);
  prompt.push(`- For voice notes: acknowledge receipt, suggest they text if it's important`);
  if (isGroup(chatJid)) {
    prompt.push(`- Group chat: match the energy, don't over-explain, be a good participant`);
  }

  const fullPrompt = prompt.join('\n');

  // Build CLI args
  const args = ['-p', '--output-format', 'text'];
  if (CONFIG.claudeModel) args.push('--model', CONFIG.claudeModel);
  if (sessionId) args.push('--resume', sessionId);
  if (!isAdminUser) args.push('--disallowedTools', 'Bash,Execute');

  const sysPrompt = [
    `You are ${CONFIG.botName}, a WhatsApp AI. Personality: helpful, witty, concise.`,
    isAdminUser ? 'Admin user — full server access.' : 'Regular user — conversational only.',
    'Keep responses WhatsApp-length. Use @ to read media files when referenced.',
    'Update memory.md when you learn key facts about people.',
  ].join(' ');
  args.push('--append-system-prompt', sysPrompt);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(CONFIG.claudePath, args, {
      cwd: cDir,
      timeout: CONFIG.maxResponseTime,
      env: { ...process.env, TERM: 'dumb' },
    });

    proc.stdin.write(fullPrompt);
    proc.stdin.end();

    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', async (code) => {
      if (code !== 0 && !stdout) {
        logger.error({ code, stderr: stderr.substring(0, 300) }, 'Claude error');
        resolve('⚠️ Had a hiccup. Try again?');
        return;
      }

      // Save session
      const match = stderr.match(/session[:\s]+([a-f0-9-]+)/i);
      if (match) await saveSessionId(chatJid, match[1]);

      let response = stdout.trim();
      if (response.length > 4000) {
        response = response.substring(0, 3900) + '\n\n... [ask me to continue]';
      }
      resolve(response || "🤔 Nothing came to mind. Try rephrasing?");
    });

    proc.on('error', (err) => {
      logger.error({ err }, 'Spawn failed');
      resolve('⚠️ Claude CLI unavailable.');
    });
  });
}

// ============================================================
// MESSAGE BATCHER
// ============================================================

class MessageBatcher {
  constructor() {
    this.pending = new Map();
  }

  add(chatJid, message) {
    return new Promise((resolve) => {
      if (this.pending.has(chatJid)) {
        const batch = this.pending.get(chatJid);
        batch.messages.push(message);
        clearTimeout(batch.timer);
        batch.timer = setTimeout(() => {
          this.pending.delete(chatJid);
          resolve(batch.messages);
        }, CONFIG.batchWindowMs);
      } else {
        const batch = {
          messages: [message],
          timer: setTimeout(() => {
            this.pending.delete(chatJid);
            resolve(batch.messages);
          }, CONFIG.batchWindowMs),
        };
        this.pending.set(chatJid, batch);
      }
    });
  }
}

const messageBatcher = new MessageBatcher();

// ============================================================
// RATE LIMITER
// ============================================================

const rateLimits = new Map();

function checkRateLimit(jid) {
  const key = senderNumber(jid);
  const stamps = (rateLimits.get(key) || []).filter(t => Date.now() - t < 60_000);
  stamps.push(Date.now());
  rateLimits.set(key, stamps);
  return stamps.length <= CONFIG.maxMessagesPerMinute;
}

// ============================================================
// SPECIAL COMMANDS
// ============================================================

async function handleSpecialCommand(text, chatJid, senderJid) {
  const cmd = text.toLowerCase().trim();

  if (cmd === '/status' && isAdmin(senderJid)) {
    try {
      const { stdout } = await execAsync('echo "🖥️ Server" && uptime -p && echo "" && free -h | head -2 && echo "" && df -h / | tail -1 && echo "" && echo "Claude:" && which claude && claude --version 2>/dev/null || echo "version unknown"');
      return stdout;
    } catch { return '⚠️ Could not fetch status.'; }
  }

  if (cmd === '/memory') return `🧠 Memory:\n\n${await getMemory(chatJid)}`;

  if (cmd === '/clear') {
    try { await fs.unlink(path.join(contactDir(chatJid), 'session_id')); } catch { }
    return '🔄 Session cleared!';
  }

  if (cmd === '/context') return `📜 Recent context:\n\n${conversationContext.format(chatJid, 10)}`;

  if (cmd === '/mode') return `⚙️ Mode: ${CONFIG.responseMode} | Threshold: ${CONFIG.chimeInThreshold}`;

  if (cmd.startsWith('/mode ') && isAdmin(senderJid)) {
    const m = cmd.split(' ')[1];
    if (['all', 'smart', 'mention'].includes(m)) {
      CONFIG.responseMode = m;
      return `✅ Mode → ${m}`;
    }
    return '❌ Use: all, smart, or mention';
  }

  if (cmd.startsWith('/threshold ') && isAdmin(senderJid)) {
    const val = parseFloat(cmd.split(' ')[1]);
    if (!isNaN(val) && val >= 0 && val <= 1) {
      CONFIG.chimeInThreshold = val;
      return `✅ Chime-in threshold → ${val}`;
    }
    return '❌ Use a value between 0.0 and 1.0';
  }

  if (cmd === '/help') {
    return [
      `🤖 *${CONFIG.botName} v2.0*`,
      '',
      '💬 I read all messages and respond when I have something useful to add.',
      '📎 Send images, docs, PDFs — I analyze them.',
      '↩️ Reply to my messages to continue a thread.',
      '',
      '⚡ Commands:',
      '/help — This',
      '/status — Server info (admin)',
      '/memory — Chat memory',
      '/clear — Reset session',
      '/context — Message buffer',
      '/mode — View response mode',
      '/mode [all|smart|mention] — Change mode',
      '/threshold [0.0-1.0] — Smart mode chattiness',
    ].join('\n');
  }

  return null;
}

// ============================================================
// CONTACT NAMES
// ============================================================
const contactNames = new Map();

// ============================================================
// WHATSAPP BOT
// ============================================================

async function startBot() {
  ensureDir(CONFIG.authDir);
  ensureDir(CONFIG.dataDir);
  ensureDir(CONFIG.logsDir);
  ensureDir(CONFIG.mediaDir);

  const { state, saveCreds } = await useMultiFileAuthState(CONFIG.authDir);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
    },
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: false,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) console.log('\n📱 Scan QR code with WhatsApp:\n');

    if (connection === 'close') {
      const code = (lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        logger.info('🔄 Reconnecting in 5s...');
        setTimeout(startBot, 5000);
      } else {
        logger.error('🚫 Logged out. Delete ./auth and restart.');
      }
    }

    if (connection === 'open') {
      console.log('\n✅ Connected to WhatsApp!');
      console.log(`👤 Admin: ${CONFIG.adminNumber}`);
      console.log(`🤖 Bot: ${CONFIG.botName}`);
      console.log(`📡 Mode: ${CONFIG.responseMode} (threshold: ${CONFIG.chimeInThreshold})`);
      console.log('📨 Listening for messages...\n');
    }
  });

  // Track contact names
  sock.ev.on('contacts.upsert', (contacts) => {
    for (const c of contacts) {
      if (c.id && c.notify) contactNames.set(c.id, c.notify);
    }
  });

  // ---- MAIN MESSAGE HANDLER ----
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      try {
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const chatJid = msg.key.remoteJid;
        const senderJid = isGroup(chatJid) ? msg.key.participant : chatJid;

        // Track names
        if (msg.pushName) contactNames.set(senderJid, msg.pushName);
        const senderName = msg.pushName || contactNames.get(senderJid) || senderNumber(senderJid);

        // Parse
        const parsed = parseMessage(msg);
        if (!parsed) continue;

        // Reactions: log only, don't process further
        if (parsed.type === 'reaction') {
          conversationContext.add(chatJid, {
            sender: senderNumber(senderJid), senderName, role: 'user',
            type: 'reaction', emoji: parsed.emoji,
          });
          continue;
        }

        // Download media
        let mediaResult = null;
        if (parsed.hasMedia) {
          mediaResult = await handleMedia(msg, chatJid, sock);
          if (mediaResult && !mediaResult.skipped) parsed.filePath = mediaResult.filePath;
        }

        // Add ALL messages to context (even ones we won't respond to)
        conversationContext.add(chatJid, {
          sender: senderNumber(senderJid), senderName, role: 'user',
          type: parsed.type, text: parsed.text, caption: parsed.caption,
          filePath: mediaResult?.filePath, fileName: parsed.fileName,
          latitude: parsed.latitude, longitude: parsed.longitude,
          locationName: parsed.locationName, contactName: parsed.contactName,
          quotedText: parsed.quotedText,
        });

        await logMessage(chatJid, senderJid, 'user', {
          type: parsed.type, text: parsed.text,
          media: mediaResult ? { path: mediaResult.filePath, mime: mediaResult.mimeType } : null,
        });

        logger.info(`${isGroup(chatJid) ? '👥' : '💬'} ${senderName}: ${(parsed.text || `[${parsed.type}]`).substring(0, 100)}`);

        // Rate limit
        if (!checkRateLimit(senderJid)) {
          await sock.sendMessage(chatJid, { text: CONFIG.cooldownMessage });
          continue;
        }

        // Read receipts
        if (CONFIG.readReceipts) await sock.readMessages([msg.key]).catch(() => {});

        // Special commands
        if (parsed.type === 'text' && parsed.text?.startsWith('/')) {
          const cmdResp = await handleSpecialCommand(parsed.text, chatJid, senderJid);
          if (cmdResp) {
            await sock.sendMessage(chatJid, { text: cmdResp });
            conversationContext.add(chatJid, { sender: 'bot', senderName: CONFIG.botName, role: 'bot', type: 'text', text: cmdResp });
            await logMessage(chatJid, senderJid, 'bot', cmdResp);
            continue;
          }
        }

        // ---- TRIAGE: Should we respond? ----
        const triage = await shouldRespondSmart(parsed, chatJid, senderJid);
        logger.info(`🧠 ${triage.shouldRespond ? '✅' : '⏭️'} ${triage.reason}`);
        if (!triage.shouldRespond) continue;

        // Batch rapid-fire messages
        const batched = await messageBatcher.add(chatJid, { parsed, mediaResult, senderJid });
        const last = batched[batched.length - 1];

        if (batched.length > 1) logger.info(`📦 Batched ${batched.length} messages`);

        // Typing indicator
        if (CONFIG.typingIndicator) await sock.sendPresenceUpdate('composing', chatJid).catch(() => {});

        // Ask Claude
        const response = await askClaude(chatJid, last.senderJid, last.parsed, last.mediaResult, triage.reason);

        // Stop typing
        if (CONFIG.typingIndicator) await sock.sendPresenceUpdate('paused', chatJid).catch(() => {});

        // Send
        await sock.sendMessage(chatJid, { text: response });

        // Track in context
        conversationContext.add(chatJid, {
          sender: 'bot', senderName: CONFIG.botName, role: 'bot', type: 'text', text: response,
        });
        await logMessage(chatJid, senderJid, 'bot', response);
        logger.info(`📤 → ${senderName}: ${response.substring(0, 100)}...`);

      } catch (err) {
        logger.error({ err, key: msg.key }, 'Message handler error');
      }
    }
  });

  return sock;
}

// ============================================================
// SHUTDOWN
// ============================================================
process.on('SIGINT', () => { console.log('\n👋 Bye!'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n👋 Bye!'); process.exit(0); });

// ============================================================
// START
// ============================================================
console.log(`
╔══════════════════════════════════════════════════════╗
║   WhatsApp ↔ Claude Code Bridge v2.0                 ║
║                                                       ║
║   🖼️  Media: Images, Docs, PDFs, Audio, Location      ║
║   🧠 Smart: Reads everything, responds intelligently   ║
║   💾 Memory: Per-chat persistent context                ║
║   ⚡ Modes: all | smart | mention                       ║
╚══════════════════════════════════════════════════════════╝
`);

startBot().catch((err) => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
