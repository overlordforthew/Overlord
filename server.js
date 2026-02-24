/**
 * server.js — HTTP API for proactive notifications and webhooks
 * Runs alongside Baileys WhatsApp connection on a separate port.
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { addReminder, removeReminder, listReminders } from './scheduler.js';

const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || '';
const WEBHOOK_PORT = parseInt(process.env.WEBHOOK_PORT || '3001');
const ADMIN_JID = `${process.env.ADMIN_NUMBER}@s.whatsapp.net`;

// sockRef is a mutable wrapper { sock } so the server always uses the latest socket after reconnects
export function startServer(sockRef, sendResponse) {
  const app = express();

  // Capture raw body for webhook signature validation, then parse JSON
  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  // Bearer token auth middleware
  function requireToken(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!WEBHOOK_TOKEN || token !== WEBHOOK_TOKEN) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  // GET /health — no auth needed
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: Math.floor(process.uptime()) });
  });

  // POST /api/send — send message to any chat (requires token)
  app.post('/api/send', requireToken, async (req, res) => {
    try {
      const { to, text, media } = req.body;
      const jid = to === 'admin' ? ADMIN_JID : to;
      if (!jid || (!text && !media)) {
        return res.status(400).json({ error: 'Missing to, text, or media' });
      }
      const message = media ? `${text || ''}\n${media}`.trim() : text;
      await sendResponse(sockRef.sock, jid, message);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /webhook/github — GitHub push/PR notifications
  app.post('/webhook/github', async (req, res) => {
    try {
      const secret = process.env.GITHUB_WEBHOOK_SECRET;
      if (secret) {
        const sig = req.headers['x-hub-signature-256'];
        const expected = 'sha256=' + crypto.createHmac('sha256', secret)
          .update(req.rawBody).digest('hex');
        if (sig !== expected) return res.status(401).json({ error: 'Bad signature' });
      }

      const event = req.headers['x-github-event'];
      const p = req.body;
      let message = '';

      if (event === 'push') {
        const commits = p.commits?.length || 0;
        const branch = p.ref?.replace('refs/heads/', '');
        message = `GitHub: ${commits} commit(s) pushed to ${p.repository?.name}/${branch} by ${p.pusher?.name}`;
      } else if (event === 'pull_request') {
        message = `GitHub PR ${p.action}: "${p.pull_request?.title}" on ${p.repository?.name}`;
      } else if (event === 'issues') {
        message = `GitHub issue ${p.action}: "${p.issue?.title}" on ${p.repository?.name}`;
      } else {
        message = `GitHub: ${event} on ${p.repository?.name || 'unknown'}`;
      }

      await sockRef.sock.sendMessage(ADMIN_JID, { text: message });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /webhook/coolify — deploy notifications
  app.post('/webhook/coolify', async (req, res) => {
    try {
      const { status, project, environment, message: msg } = req.body;
      const text = msg || `Coolify: ${project || 'unknown'} deploy ${status || 'update'} (${environment || 'production'})`;
      await sockRef.sock.sendMessage(ADMIN_JID, { text });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- Schedule Management ----

  // POST /api/schedule — create reminder via API
  app.post('/api/schedule', requireToken, async (req, res) => {
    try {
      const { cron: cronExpr, text, chatJid, oneshot } = req.body;
      if (!cronExpr || !text) {
        return res.status(400).json({ error: 'Missing cron or text' });
      }
      const jid = chatJid || ADMIN_JID;
      const reminder = await addReminder(jid, cronExpr, text, oneshot, sockRef);
      if (reminder) {
        res.json({ success: true, reminder });
      } else {
        res.status(400).json({ error: 'Invalid cron expression' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/schedules — list active schedules
  app.get('/api/schedules', requireToken, async (_req, res) => {
    try {
      const reminders = await listReminders();
      res.json({ schedules: reminders });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/schedule/:id — cancel schedule
  app.delete('/api/schedule/:id', requireToken, async (req, res) => {
    try {
      const removed = await removeReminder(req.params.id);
      if (removed) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Schedule not found' });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- WhatsApp Admin Tools ----

  // GET /api/contacts — fetch all contacts from WhatsApp groups (uses existing socket)
  app.get('/api/contacts', requireToken, async (_req, res) => {
    try {
      const AUTH_DIR = process.env.AUTH_DIR || './auth';

      // Load LID reverse mappings
      const lidMappings = new Map();
      try {
        const files = fs.readdirSync(AUTH_DIR);
        for (const file of files) {
          if (file.startsWith('lid-mapping-') && file.endsWith('_reverse.json')) {
            try {
              const lid = file.replace('lid-mapping-', '').replace('_reverse.json', '');
              const content = fs.readFileSync(path.join(AUTH_DIR, file), 'utf-8');
              const phone = JSON.parse(content);
              if (typeof phone === 'string') lidMappings.set(lid, phone);
            } catch { /* skip invalid */ }
          }
        }
      } catch { /* no mappings available */ }

      const groups = await sockRef.sock.groupFetchAllParticipating();

      const contacts = {};
      const groupList = [];

      for (const [jid, meta] of Object.entries(groups)) {
        groupList.push({
          id: jid,
          subject: meta.subject,
          participantCount: meta.participants?.length || 0,
        });

        for (const participant of meta.participants || []) {
          let rawId = participant.id?.split('@')[0];
          if (!rawId || rawId.includes(':')) continue;

          let phone, lid;
          if (lidMappings.has(rawId)) {
            phone = `+${lidMappings.get(rawId)}`;
            lid = rawId;
          } else if (rawId.length > 15) {
            phone = `LID:${rawId}`;
            lid = rawId;
          } else {
            phone = `+${rawId}`;
          }

          if (!contacts[phone]) {
            contacts[phone] = { phone, lid, groups: [], isAdmin: false };
          }
          contacts[phone].groups.push({
            id: jid,
            name: meta.subject,
            isAdmin: !!participant.admin,
          });
          if (participant.admin) contacts[phone].isAdmin = true;
        }
      }

      const sorted = Object.values(contacts).sort((a, b) => b.groups.length - a.groups.length);
      const resolved = sorted.filter(c => !c.phone.startsWith('LID:'));
      const unresolved = sorted.filter(c => c.phone.startsWith('LID:'));

      res.json({
        extracted: new Date().toISOString(),
        stats: {
          totalGroups: groupList.length,
          totalContacts: sorted.length,
          resolvedContacts: resolved.length,
          unresolvedLids: unresolved.length,
          lidMappingsLoaded: lidMappings.size,
        },
        groups: groupList.sort((a, b) => b.participantCount - a.participantCount),
        contacts: resolved,
        unresolvedContacts: unresolved.length > 0 ? unresolved : undefined,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/groups — create a WhatsApp group (uses existing socket)
  app.post('/api/groups', requireToken, async (req, res) => {
    try {
      const { name, participants } = req.body;
      if (!name || !Array.isArray(participants) || participants.length === 0) {
        return res.status(400).json({ error: 'Missing name or participants array (E.164 phone numbers)' });
      }

      // Convert phone numbers to JIDs
      const jids = participants.map(p => {
        const cleaned = p.replace(/[^0-9]/g, '');
        return `${cleaned}@s.whatsapp.net`;
      });

      const result = await sockRef.sock.groupCreate(name, jids);
      res.json({
        success: true,
        group: {
          id: result.id,
          name: result.subject,
          created: new Date(result.creation * 1000).toISOString(),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/groups/:jid — leave a WhatsApp group (uses existing socket)
  app.delete('/api/groups/:jid', requireToken, async (req, res) => {
    try {
      const jid = req.params.jid;
      const myId = sockRef.sock.user?.id?.replace(/:.*@/, '@');
      if (!myId) return res.status(500).json({ error: 'Bot JID not available' });
      await sockRef.sock.groupParticipantsUpdate(jid, [myId], 'remove');
      res.json({ success: true, left: jid });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /webhook/generic — generic webhook (requires token)
  app.post('/webhook/generic', requireToken, async (req, res) => {
    try {
      const { message, to } = req.body;
      const jid = to === 'admin' || !to ? ADMIN_JID : to;
      if (!message) return res.status(400).json({ error: 'Missing message' });
      await sockRef.sock.sendMessage(jid, { text: message });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ---- MasterCommander Auth ----

  // PostgreSQL pool for MasterCommander
  const mcPool = new pg.Pool({
    host: process.env.MC_DB_HOST,
    port: parseInt(process.env.MC_DB_PORT || '5432'),
    database: process.env.MC_DB_NAME,
    user: process.env.MC_DB_USER,
    password: process.env.MC_DB_PASS,
  });

  // Auto-init users table
  mcPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      reset_token VARCHAR(64),
      reset_expires TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(err => console.error('[mc-auth] DB init error:', err.message));

  const MC_JWT_SECRET = process.env.MC_JWT_SECRET || 'fallback-dev-secret';

  // SMTP transport (falls back to console logging if not configured)
  let mcMailer = null;
  if (process.env.MC_SMTP_USER && process.env.MC_SMTP_PASS) {
    mcMailer = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.MC_SMTP_USER, pass: process.env.MC_SMTP_PASS },
    });
  }

  // CORS for /api/auth
  app.use('/api/auth', (req, res, next) => {
    const origin = req.headers.origin || '';
    if (origin.includes('mastercommander.namibarden.com') || origin.includes('localhost')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Rate limiters for auth endpoints
  const authRateMap = new Map();
  function authRateLimit(max, windowMs) {
    return (req, res, next) => {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
      const key = `${req.path}:${ip}`;
      const now = Date.now();
      let hits = authRateMap.get(key) || [];
      hits = hits.filter(t => now - t < windowMs);
      if (hits.length >= max) {
        return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
      }
      hits.push(now);
      authRateMap.set(key, hits);
      next();
    };
  }
  // Cleanup auth rate map every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [key, hits] of authRateMap) {
      const valid = hits.filter(t => now - t < 300_000);
      if (valid.length === 0) authRateMap.delete(key);
      else authRateMap.set(key, valid);
    }
  }, 300_000);

  // JWT helper
  function signToken(user) {
    return jwt.sign({ id: user.id, email: user.email, name: user.name }, MC_JWT_SECRET, { expiresIn: '180d' });
  }

  // POST /api/auth/signup
  app.post('/api/auth/signup', authRateLimit(10, 60_000), async (req, res) => {
    try {
      const { email, name, password } = req.body;
      if (!email || !name || !password) {
        return res.status(400).json({ error: 'Email, name, and password are required.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      const emailLower = email.toLowerCase().trim();
      // Check existing
      const existing = await mcPool.query('SELECT id FROM users WHERE email = $1', [emailLower]);
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      const hash = await bcrypt.hash(password, 10);
      const result = await mcPool.query(
        'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id, email, name, created_at',
        [emailLower, name.trim(), hash]
      );
      const user = result.rows[0];
      const token = signToken(user);
      res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
      console.error('[mc-auth] Signup error:', err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // POST /api/auth/login
  app.post('/api/auth/login', authRateLimit(5, 60_000), async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }
      const result = await mcPool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      const user = result.rows[0];
      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      const token = signToken(user);
      res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
    } catch (err) {
      console.error('[mc-auth] Login error:', err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // GET /api/auth/session
  app.get('/api/auth/session', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided.' });
      }
      const decoded = jwt.verify(authHeader.slice(7), MC_JWT_SECRET);
      const result = await mcPool.query('SELECT id, email, name FROM users WHERE id = $1', [decoded.id]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'User not found.' });
      }
      res.json({ user: result.rows[0] });
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
  });

  // POST /api/auth/forgot-password
  app.post('/api/auth/forgot-password', authRateLimit(3, 300_000), async (req, res) => {
    try {
      const { email } = req.body;
      if (!email) return res.status(400).json({ error: 'Email is required.' });
      // Always return success to prevent email enumeration
      const result = await mcPool.query('SELECT id, email, name FROM users WHERE email = $1', [email.toLowerCase().trim()]);
      if (result.rows.length > 0) {
        const user = result.rows[0];
        const token = crypto.randomBytes(32).toString('hex');
        const expires = new Date(Date.now() + 15 * 60_000); // 15 min TTL
        await mcPool.query('UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3', [token, expires, user.id]);
        const resetUrl = `https://mastercommander.namibarden.com?reset=${token}`;
        if (mcMailer) {
          await mcMailer.sendMail({
            from: `"Master&Commander" <${process.env.MC_SMTP_USER}>`,
            to: user.email,
            subject: 'Reset your Master&Commander password',
            html: `<p>Hi ${user.name},</p><p>Click the link below to reset your password. This link expires in 15 minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can safely ignore this email.</p>`,
          });
        } else {
          console.log(`[mc-auth] Password reset link (no SMTP configured): ${resetUrl}`);
        }
      }
      res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
    } catch (err) {
      console.error('[mc-auth] Forgot password error:', err.message);
      res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
    }
  });

  // POST /api/auth/reset-password
  app.post('/api/auth/reset-password', authRateLimit(5, 60_000), async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ error: 'Token and new password are required.' });
      }
      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      const result = await mcPool.query(
        'SELECT id FROM users WHERE reset_token = $1 AND reset_expires > NOW()',
        [token]
      );
      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired reset link.' });
      }
      const hash = await bcrypt.hash(password, 10);
      await mcPool.query(
        'UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2',
        [hash, result.rows[0].id]
      );
      res.json({ message: 'Password reset successfully. You can now log in.' });
    } catch (err) {
      console.error('[mc-auth] Reset password error:', err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // ---- Web Chat (MasterCommander) ----

  // CORS for mastercommander.namibarden.com
  app.use('/api/web-chat', (req, res, next) => {
    const origin = req.headers.origin || '';
    if (origin.includes('mastercommander.namibarden.com') || origin.includes('localhost')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Rate limiter: 10 messages per minute per IP
  const chatRateMap = new Map();
  function chatRateLimit(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const now = Date.now();
    const window = 60_000;
    const max = 10;
    let hits = chatRateMap.get(ip) || [];
    hits = hits.filter(t => now - t < window);
    if (hits.length >= max) {
      return res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
    }
    hits.push(now);
    chatRateMap.set(ip, hits);
    next();
  }
  // Cleanup rate map every 5 minutes
  setInterval(() => {
    const now = Date.now();
    for (const [ip, hits] of chatRateMap) {
      const valid = hits.filter(t => now - t < 60_000);
      if (valid.length === 0) chatRateMap.delete(ip);
      else chatRateMap.set(ip, valid);
    }
  }, 300_000);

  // In-memory conversation store (per session, max 20 exchanges, auto-expire after 30 min)
  const chatSessions = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of chatSessions) {
      if (now - session.lastActive > 30 * 60_000) chatSessions.delete(id);
    }
  }, 60_000);

  const MC_SYSTEM_PROMPT = `You are the Master&Commander sales assistant on the mastercommander.namibarden.com website.

You help visitors learn about Master&Commander — an AI boat monitoring system for charter fleets, private yachts, deliveries, and marinas.

KEY PRODUCT INFO:
- Commander Unit plugs into NMEA 2000, monitors 24/7, sends alerts via WhatsApp
- Three hardware options: Raspberry Pi (charter fleets, $240/yr/boat), Delivery Puck (~$370 plug-and-play), Mac Mini M4 (private yachts, local AI, custom pricing)
- Master Cloud: fleet dashboard, analytics, OTA updates, FleetMind shared intelligence
- FleetMind: crowdsourced wind, depth, anchorage intel, hazard alerts across connected boats
- Works with Garmin, Raymarine, Simrad, B&G, Victron, and all NMEA 2000 devices
- Offline-first: Mac Mini works without internet; Raspberry Pi needs connectivity for cloud AI
- WhatsApp alerts work without any subscription (just Commander + internet)
- 67+ use cases across charter ops, private ownership, deliveries, marinas, insurance, service yards

BEHAVIOR:
- Be friendly, knowledgeable, and concise
- Answer questions about the product, pricing, hardware, and capabilities
- If someone is ready to buy or wants to talk to a human, direct them to WhatsApp: https://wa.me/13055601031
- Don't make up features that aren't listed above
- Keep responses under 150 words unless a detailed explanation is needed
- Never share server details, API keys, or internal infrastructure info`;

  app.post('/api/web-chat', chatRateLimit, async (req, res) => {
    try {
      const { message, sessionId } = req.body;
      if (!message || typeof message !== 'string' || message.length > 1000) {
        return res.status(400).json({ error: 'Message required (max 1000 chars)' });
      }

      const sid = sessionId || crypto.randomUUID();
      let session = chatSessions.get(sid);
      if (!session) {
        session = { history: [], lastActive: Date.now() };
        chatSessions.set(sid, session);
      }
      session.lastActive = Date.now();

      // Build conversation context
      session.history.push({ role: 'user', text: message });
      // Keep last 10 exchanges
      if (session.history.length > 20) session.history = session.history.slice(-20);

      // Build messages for OpenRouter API
      const apiMessages = [
        { role: 'system', content: MC_SYSTEM_PROMPT },
        ...session.history.map(m => ({
          role: m.role === 'user' ? 'user' : 'assistant',
          content: m.text
        }))
      ];

      const controller = new AbortController();
      const tm = setTimeout(() => controller.abort(), 30_000);

      const apiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_KEY}`,
        },
        body: JSON.stringify({
          model: 'openai/gpt-4.1-nano',
          messages: apiMessages,
          max_tokens: 400,
        }),
        signal: controller.signal,
      });
      clearTimeout(tm);

      const data = await apiRes.json();
      const response = data.choices?.[0]?.message?.content?.trim();

      if (!response) {
        console.error('[web-chat] Empty API response:', JSON.stringify(data).slice(0, 300));
        return res.status(500).json({ error: 'No response generated. Please try again.' });
      }

      session.history.push({ role: 'assistant', text: response });
      res.json({ response, sessionId: sid });
    } catch (err) {
      console.error('[web-chat] Error:', err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP API listening on port ${WEBHOOK_PORT}`);
  });

  return app;
}
