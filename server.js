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

  // Trust first proxy (Traefik) so req.ip is the real client IP
  app.set('trust proxy', 1);

  // Capture raw body for webhook signature validation, then parse JSON
  app.use(express.json({
    limit: '1mb',
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  // Catch malformed JSON bodies (bad escapes, trailing commas, etc.)
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
    next(err);
  });

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
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 20,
    statement_timeout: 30000,
  });

  mcPool.on('error', (err) => {
    console.error('[mc-auth] Unexpected error on idle client:', err.message);
  });

  // Auto-init users table + migrations
  (async () => {
    try {
      await mcPool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          name VARCHAR(255) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          reset_token VARCHAR(64),
          reset_expires TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      // Phase 2 migrations
      await mcPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE`);
      await mcPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token VARCHAR(64)`);
      await mcPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_expires TIMESTAMP`);
      await mcPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50)`);
      await mcPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company VARCHAR(255)`);
      await mcPool.query(`
        CREATE TABLE IF NOT EXISTS boats (
          id SERIAL PRIMARY KEY,
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name VARCHAR(255) NOT NULL,
          model VARCHAR(255),
          year INT,
          mmsi VARCHAR(20),
          home_port VARCHAR(255),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await mcPool.query(`CREATE INDEX IF NOT EXISTS idx_boats_user_id ON boats(user_id)`);
      // Dashboard phase migrations — boats extended fields
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'inactive'`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS boat_type VARCHAR(50)`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS length_ft NUMERIC(5,1)`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS beam_ft NUMERIC(5,1)`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS draft_ft NUMERIC(5,1)`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS fuel_capacity INT`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS water_capacity INT`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS engine_count INT DEFAULT 1`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS engine_type VARCHAR(100)`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS registration VARCHAR(100)`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS flag VARCHAR(100)`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS photo_url TEXT`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS notes TEXT`);
      await mcPool.query(`ALTER TABLE boats ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
      // Boat logs table
      await mcPool.query(`
        CREATE TABLE IF NOT EXISTS boat_logs (
          id SERIAL PRIMARY KEY,
          boat_id INT NOT NULL REFERENCES boats(id) ON DELETE CASCADE,
          user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          log_type VARCHAR(20) NOT NULL DEFAULT 'note',
          title VARCHAR(255),
          body TEXT,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await mcPool.query(`CREATE INDEX IF NOT EXISTS idx_boat_logs_boat_id ON boat_logs(boat_id)`);
      // User role column
      await mcPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'owner'`);
      await mcPool.query(`
        CREATE TABLE IF NOT EXISTS contact_submissions (
          id SERIAL PRIMARY KEY,
          source VARCHAR(100),
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          subject VARCHAR(255),
          message TEXT NOT NULL,
          plan VARCHAR(100),
          ip VARCHAR(45),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      await mcPool.query(`
        CREATE TABLE IF NOT EXISTS newsletter_subscribers (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          source VARCHAR(100) DEFAULT 'newsletter-form',
          ip VARCHAR(45),
          subscribed_at TIMESTAMP DEFAULT NOW(),
          unsubscribed_at TIMESTAMP
        )
      `);
      // Site Gate tables
      await mcPool.query(`
        CREATE TABLE IF NOT EXISTS gate_users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          code VARCHAR(6),
          code_expires TIMESTAMP,
          code_attempts INT DEFAULT 0,
          verified BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMP DEFAULT NOW(),
          last_access TIMESTAMP DEFAULT NOW(),
          UNIQUE(email)
        )
      `);
      await mcPool.query(`
        CREATE TABLE IF NOT EXISTS gate_nda (
          id SERIAL PRIMARY KEY,
          gate_user_id INT NOT NULL REFERENCES gate_users(id) ON DELETE CASCADE,
          site VARCHAR(100) NOT NULL,
          ip VARCHAR(45),
          user_agent TEXT,
          accepted_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(gate_user_id, site)
        )
      `);
      console.log('[mc-auth] DB init + migrations complete');
    } catch (err) {
      console.error('[mc-auth] DB init error:', err.message);
    }
  })();

  const MC_JWT_SECRET = process.env.MC_JWT_SECRET || 'fallback-dev-secret';

  // SMTP transport (falls back to console logging if not configured)
  let mcMailer = null;
  if (process.env.MC_SMTP_USER && process.env.MC_SMTP_PASS) {
    mcMailer = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
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

  // Reusable JWT auth middleware for MasterCommander
  function requireMcAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    try {
      const decoded = jwt.verify(authHeader.slice(7), MC_JWT_SECRET);
      req.mcUser = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
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
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const verifyExpires = new Date(Date.now() + 24 * 60 * 60_000); // 24h TTL
      const result = await mcPool.query(
        'INSERT INTO users (email, name, password_hash, verify_token, verify_expires) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, created_at',
        [emailLower, name.trim(), hash, verifyToken, verifyExpires]
      );
      const user = result.rows[0];
      // Send verification email
      const verifyUrl = `https://mastercommander.namibarden.com?verify=${verifyToken}`;
      if (mcMailer) {
        mcMailer.sendMail({
          from: `"Master&Commander" <${process.env.MC_SMTP_USER}>`,
          to: user.email,
          subject: 'Verify your Master&Commander email',
          html: `<p>Hi ${name.trim()},</p><p>Welcome to Master&Commander! Please verify your email by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
        }).catch(err => console.error('[mc-auth] Verify email send error:', err.message));
      } else {
        console.log(`[mc-auth] Verification link (no SMTP): ${verifyUrl}`);
      }
      const token = signToken(user);
      res.status(201).json({ token, user: { id: user.id, email: user.email, name: user.name, email_verified: false } });
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
      res.json({ token, user: { id: user.id, email: user.email, name: user.name, email_verified: !!user.email_verified } });
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
      const result = await mcPool.query('SELECT id, email, name, email_verified, phone, company FROM users WHERE id = $1', [decoded.id]);
      if (result.rows.length === 0) {
        return res.status(401).json({ error: 'User not found.' });
      }
      const u = result.rows[0];
      res.json({ user: { id: u.id, email: u.email, name: u.name, email_verified: !!u.email_verified, phone: u.phone || '', company: u.company || '' } });
    } catch {
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

  // POST /api/auth/verify-email
  app.post('/api/auth/verify-email', authRateLimit(5, 60_000), async (req, res) => {
    try {
      const { token } = req.body;
      if (!token) return res.status(400).json({ error: 'Verification token is required.' });
      const result = await mcPool.query(
        'SELECT id FROM users WHERE verify_token = $1 AND verify_expires > NOW()',
        [token]
      );
      if (result.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid or expired verification link.' });
      }
      await mcPool.query(
        'UPDATE users SET email_verified = TRUE, verify_token = NULL, verify_expires = NULL WHERE id = $1',
        [result.rows[0].id]
      );
      res.json({ message: 'Email verified successfully!' });
    } catch (err) {
      console.error('[mc-auth] Verify email error:', err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // POST /api/auth/resend-verify
  app.post('/api/auth/resend-verify', requireMcAuth, authRateLimit(3, 300_000), async (req, res) => {
    try {
      const result = await mcPool.query('SELECT id, email, name, email_verified FROM users WHERE id = $1', [req.mcUser.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
      const user = result.rows[0];
      if (user.email_verified) return res.json({ message: 'Email is already verified.' });
      const verifyToken = crypto.randomBytes(32).toString('hex');
      const verifyExpires = new Date(Date.now() + 24 * 60 * 60_000);
      await mcPool.query('UPDATE users SET verify_token = $1, verify_expires = $2 WHERE id = $3', [verifyToken, verifyExpires, user.id]);
      const verifyUrl = `https://mastercommander.namibarden.com?verify=${verifyToken}`;
      if (mcMailer) {
        await mcMailer.sendMail({
          from: `"Master&Commander" <${process.env.MC_SMTP_USER}>`,
          to: user.email,
          subject: 'Verify your Master&Commander email',
          html: `<p>Hi ${user.name},</p><p>Please verify your email by clicking the link below:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
        });
      }
      res.json({ message: 'Verification email sent.' });
    } catch (err) {
      console.error('[mc-auth] Resend verify error:', err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // ---- MasterCommander User Profile ----

  // CORS for /api/user
  app.use('/api/user', (req, res, next) => {
    const origin = req.headers.origin || '';
    if (origin.includes('mastercommander.namibarden.com') || origin.includes('localhost')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // GET /api/user/profile
  app.get('/api/user/profile', requireMcAuth, authRateLimit(20, 60_000), async (req, res) => {
    try {
      const result = await mcPool.query(
        'SELECT id, email, name, email_verified, phone, company, created_at FROM users WHERE id = $1',
        [req.mcUser.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
      const u = result.rows[0];
      res.json({ id: u.id, email: u.email, name: u.name, email_verified: !!u.email_verified, phone: u.phone || '', company: u.company || '', created_at: u.created_at });
    } catch (err) {
      console.error('[mc-auth] Get profile error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // PUT /api/user/profile
  app.put('/api/user/profile', requireMcAuth, authRateLimit(10, 60_000), async (req, res) => {
    try {
      const { name, phone, company } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
      if (name.trim().length > 255) return res.status(400).json({ error: 'Name is too long.' });
      if (phone && phone.length > 50) return res.status(400).json({ error: 'Phone is too long.' });
      if (company && company.length > 255) return res.status(400).json({ error: 'Company name is too long.' });
      await mcPool.query(
        'UPDATE users SET name = $1, phone = $2, company = $3 WHERE id = $4',
        [name.trim(), (phone || '').trim(), (company || '').trim(), req.mcUser.id]
      );
      res.json({ message: 'Profile updated.' });
    } catch (err) {
      console.error('[mc-auth] Update profile error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // PUT /api/user/password
  app.put('/api/user/password', requireMcAuth, authRateLimit(3, 300_000), async (req, res) => {
    try {
      const { current_password, new_password } = req.body;
      if (!current_password || !new_password) return res.status(400).json({ error: 'Current and new passwords are required.' });
      if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
      const result = await mcPool.query('SELECT password_hash FROM users WHERE id = $1', [req.mcUser.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'User not found.' });
      const valid = await bcrypt.compare(current_password, result.rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });
      const hash = await bcrypt.hash(new_password, 10);
      await mcPool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.mcUser.id]);
      res.json({ message: 'Password changed successfully.' });
    } catch (err) {
      console.error('[mc-auth] Change password error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // ---- MasterCommander Boats ----

  // CORS for /api/boats
  app.use('/api/boats', (req, res, next) => {
    const origin = req.headers.origin || '';
    if (origin.includes('mastercommander.namibarden.com') || origin.includes('localhost')) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // GET /api/boats
  app.get('/api/boats', requireMcAuth, authRateLimit(20, 60_000), async (req, res) => {
    try {
      const result = await mcPool.query('SELECT * FROM boats WHERE user_id = $1 ORDER BY created_at', [req.mcUser.id]);
      res.json({ boats: result.rows });
    } catch (err) {
      console.error('[mc-boats] List error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // POST /api/boats
  app.post('/api/boats', requireMcAuth, authRateLimit(10, 60_000), async (req, res) => {
    try {
      const { name, model, year, mmsi, home_port, boat_type, length_ft, beam_ft, draft_ft, fuel_capacity, water_capacity, engine_count, engine_type, registration, flag, photo_url, notes } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Boat name is required.' });
      // Max 20 boats per user
      const countResult = await mcPool.query('SELECT COUNT(*) FROM boats WHERE user_id = $1', [req.mcUser.id]);
      if (parseInt(countResult.rows[0].count) >= 20) {
        return res.status(400).json({ error: 'Maximum 20 boats per account.' });
      }
      const result = await mcPool.query(
        `INSERT INTO boats (user_id, name, model, year, mmsi, home_port, boat_type, length_ft, beam_ft, draft_ft, fuel_capacity, water_capacity, engine_count, engine_type, registration, flag, photo_url, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
        [req.mcUser.id, name.trim(), (model || '').trim() || null, year ? parseInt(year) : null, (mmsi || '').trim() || null, (home_port || '').trim() || null,
         (boat_type || '').trim() || null, length_ft ? parseFloat(length_ft) : null, beam_ft ? parseFloat(beam_ft) : null, draft_ft ? parseFloat(draft_ft) : null,
         fuel_capacity ? parseInt(fuel_capacity) : null, water_capacity ? parseInt(water_capacity) : null, engine_count ? parseInt(engine_count) : 1,
         (engine_type || '').trim() || null, (registration || '').trim() || null, (flag || '').trim() || null, (photo_url || '').trim() || null, (notes || '').trim() || null]
      );
      res.status(201).json({ boat: result.rows[0] });
    } catch (err) {
      console.error('[mc-boats] Create error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // PUT /api/boats/:id
  app.put('/api/boats/:id', requireMcAuth, authRateLimit(10, 60_000), async (req, res) => {
    try {
      const { name, model, year, mmsi, home_port, boat_type, length_ft, beam_ft, draft_ft, fuel_capacity, water_capacity, engine_count, engine_type, registration, flag, photo_url, notes } = req.body;
      if (!name || !name.trim()) return res.status(400).json({ error: 'Boat name is required.' });
      const result = await mcPool.query(
        `UPDATE boats SET name=$1, model=$2, year=$3, mmsi=$4, home_port=$5, boat_type=$6, length_ft=$7, beam_ft=$8, draft_ft=$9,
         fuel_capacity=$10, water_capacity=$11, engine_count=$12, engine_type=$13, registration=$14, flag=$15, photo_url=$16, notes=$17, updated_at=NOW()
         WHERE id=$18 AND user_id=$19 RETURNING *`,
        [name.trim(), (model || '').trim() || null, year ? parseInt(year) : null, (mmsi || '').trim() || null, (home_port || '').trim() || null,
         (boat_type || '').trim() || null, length_ft ? parseFloat(length_ft) : null, beam_ft ? parseFloat(beam_ft) : null, draft_ft ? parseFloat(draft_ft) : null,
         fuel_capacity ? parseInt(fuel_capacity) : null, water_capacity ? parseInt(water_capacity) : null, engine_count ? parseInt(engine_count) : 1,
         (engine_type || '').trim() || null, (registration || '').trim() || null, (flag || '').trim() || null, (photo_url || '').trim() || null, (notes || '').trim() || null,
         req.params.id, req.mcUser.id]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Boat not found.' });
      res.json({ boat: result.rows[0] });
    } catch (err) {
      console.error('[mc-boats] Update error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // DELETE /api/boats/:id
  app.delete('/api/boats/:id', requireMcAuth, authRateLimit(10, 60_000), async (req, res) => {
    try {
      const result = await mcPool.query('DELETE FROM boats WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.mcUser.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Boat not found.' });
      res.json({ message: 'Boat deleted.' });
    } catch (err) {
      console.error('[mc-boats] Delete error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // GET /api/boats/:id — single boat with all fields
  app.get('/api/boats/:id', requireMcAuth, authRateLimit(20, 60_000), async (req, res) => {
    try {
      const result = await mcPool.query('SELECT * FROM boats WHERE id = $1 AND user_id = $2', [req.params.id, req.mcUser.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Boat not found.' });
      res.json({ boat: result.rows[0] });
    } catch (err) {
      console.error('[mc-boats] Get error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // GET /api/boats/:id/logs — paginated log entries
  app.get('/api/boats/:id/logs', requireMcAuth, authRateLimit(20, 60_000), async (req, res) => {
    try {
      // Verify boat ownership
      const boat = await mcPool.query('SELECT id FROM boats WHERE id = $1 AND user_id = $2', [req.params.id, req.mcUser.id]);
      if (boat.rows.length === 0) return res.status(404).json({ error: 'Boat not found.' });
      const limit = Math.min(parseInt(req.query.limit) || 50, 100);
      const offset = parseInt(req.query.offset) || 0;
      const logType = req.query.type;
      let query = 'SELECT bl.*, u.name as user_name FROM boat_logs bl JOIN users u ON u.id = bl.user_id WHERE bl.boat_id = $1';
      const params = [req.params.id];
      if (logType) { query += ' AND bl.log_type = $' + (params.length + 1); params.push(logType); }
      query += ' ORDER BY bl.created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
      params.push(limit, offset);
      const result = await mcPool.query(query, params);
      res.json({ logs: result.rows });
    } catch (err) {
      console.error('[mc-boats] Logs list error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // POST /api/boats/:id/logs — add log entry
  app.post('/api/boats/:id/logs', requireMcAuth, authRateLimit(10, 60_000), async (req, res) => {
    try {
      const boat = await mcPool.query('SELECT id FROM boats WHERE id = $1 AND user_id = $2', [req.params.id, req.mcUser.id]);
      if (boat.rows.length === 0) return res.status(404).json({ error: 'Boat not found.' });
      const { log_type, title, body, metadata } = req.body;
      const validTypes = ['note', 'maintenance', 'telemetry', 'alert'];
      const type = validTypes.includes(log_type) ? log_type : 'note';
      if (!title && !body) return res.status(400).json({ error: 'Title or body is required.' });
      const result = await mcPool.query(
        'INSERT INTO boat_logs (boat_id, user_id, log_type, title, body, metadata) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [req.params.id, req.mcUser.id, type, (title || '').trim() || null, (body || '').trim() || null, metadata ? JSON.stringify(metadata) : null]
      );
      res.status(201).json({ log: result.rows[0] });
    } catch (err) {
      console.error('[mc-boats] Log create error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // DELETE /api/boats/:id/logs/:logId — delete log entry
  app.delete('/api/boats/:id/logs/:logId', requireMcAuth, authRateLimit(10, 60_000), async (req, res) => {
    try {
      const boat = await mcPool.query('SELECT id FROM boats WHERE id = $1 AND user_id = $2', [req.params.id, req.mcUser.id]);
      if (boat.rows.length === 0) return res.status(404).json({ error: 'Boat not found.' });
      const result = await mcPool.query('DELETE FROM boat_logs WHERE id = $1 AND boat_id = $2 RETURNING id', [req.params.logId, req.params.id]);
      if (result.rows.length === 0) return res.status(404).json({ error: 'Log entry not found.' });
      res.json({ message: 'Log entry deleted.' });
    } catch (err) {
      console.error('[mc-boats] Log delete error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // ---- Site Gate (Passwordless Access Control) ----

  const GATE_SITES = {
    mastercommander: { label: 'Master&Commander', from: 'Master&Commander Access' },
  };

  const GATE_ORIGINS = new Set([
    'https://mastercommander.namibarden.com',
    'http://localhost:3000',
    'http://localhost:3010',
    'http://localhost:8080',
  ]);

  // CORS for /api/gate — accepts *.namibarden.com + localhost
  app.use('/api/gate', (req, res, next) => {
    const origin = req.headers.origin || '';
    if (GATE_ORIGINS.has(origin) || /^https?:\/\/[a-z0-9-]+\.namibarden\.com$/.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Gate rate limiter (reuses authRateMap)
  function gateRateLimit(max, windowMs) {
    return (req, res, next) => {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
      const key = `gate:${req.path}:${ip}`;
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

  // Gate JWT helper
  function signGateToken(user, opts = {}) {
    return jwt.sign(
      { id: user.id, email: user.email, name: user.name, type: 'gate', ndaAccepted: opts.ndaAccepted || false },
      MC_JWT_SECRET,
      { expiresIn: '30d' }
    );
  }

  // Gate auth middleware
  function requireGateAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required.' });
    try {
      const decoded = jwt.verify(authHeader.slice(7), MC_JWT_SECRET);
      if (decoded.type !== 'gate') return res.status(401).json({ error: 'Invalid token type.' });
      req.gateUser = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token.' });
    }
  }

  // POST /api/gate/request-code — send 6-digit code via email
  app.post('/api/gate/request-code', gateRateLimit(3, 300_000), async (req, res) => {
    try {
      const { name, email, site } = req.body || {};
      if (!name || !email || !site) return res.status(400).json({ error: 'Name, email, and site are required.' });
      if (!GATE_SITES[site]) return res.status(400).json({ error: 'Unknown site.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Upsert gate user
      await mcPool.query(`
        INSERT INTO gate_users (email, name, code, code_expires, code_attempts, verified)
        VALUES ($1, $2, $3, $4, 0, FALSE)
        ON CONFLICT (email) DO UPDATE SET
          name = EXCLUDED.name,
          code = EXCLUDED.code,
          code_expires = EXCLUDED.code_expires,
          code_attempts = 0
      `, [email.toLowerCase(), name, code, expires]);

      // Send email
      if (mcMailer) {
        const siteLabel = GATE_SITES[site].from || site;
        await mcMailer.sendMail({
          from: `"${siteLabel}" <${process.env.MC_SMTP_USER}>`,
          to: email,
          subject: `Your access code: ${code}`,
          html: `
            <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px">
              <h2 style="margin:0 0 8px;color:#1a1a2e">${GATE_SITES[site].label || site}</h2>
              <p style="color:#666;margin:0 0 24px">Your verification code is:</p>
              <div style="background:#f4f4f8;border-radius:10px;padding:20px;text-align:center;margin:0 0 24px">
                <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1a1a2e">${code}</span>
              </div>
              <p style="color:#999;font-size:13px;margin:0">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
            </div>
          `,
        });
      } else {
        console.log(`[gate] Code for ${email}: ${code} (no mailer configured)`);
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('[gate] request-code error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // POST /api/gate/verify-code — verify code, return JWT
  app.post('/api/gate/verify-code', gateRateLimit(5, 60_000), async (req, res) => {
    try {
      const { email, code, site } = req.body || {};
      if (!email || !code || !site) return res.status(400).json({ error: 'Email, code, and site are required.' });
      if (!GATE_SITES[site]) return res.status(400).json({ error: 'Unknown site.' });

      const result = await mcPool.query('SELECT * FROM gate_users WHERE email = $1', [email.toLowerCase()]);
      if (result.rows.length === 0) return res.status(400).json({ error: 'No verification pending for this email.' });

      const user = result.rows[0];

      if (user.code_attempts >= 5) {
        return res.status(429).json({ error: 'Too many failed attempts. Please request a new code.' });
      }

      if (!user.code || new Date(user.code_expires) < new Date()) {
        return res.status(400).json({ error: 'Code expired. Please request a new one.' });
      }

      if (user.code !== code) {
        await mcPool.query('UPDATE gate_users SET code_attempts = code_attempts + 1 WHERE id = $1', [user.id]);
        return res.status(400).json({ error: 'Incorrect code. Please try again.' });
      }

      // Mark verified, clear code
      await mcPool.query(
        'UPDATE gate_users SET verified = TRUE, code = NULL, code_expires = NULL, code_attempts = 0, last_access = NOW() WHERE id = $1',
        [user.id]
      );

      // Auto-create MC account (email already verified via gate code)
      const existing = await mcPool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (existing.rows.length === 0) {
        const randomPass = crypto.randomBytes(32).toString('hex');
        const hash = await bcrypt.hash(randomPass, 10);
        await mcPool.query(
          'INSERT INTO users (email, name, password_hash, email_verified) VALUES ($1, $2, $3, TRUE)',
          [email.toLowerCase(), user.name, hash]
        );
        console.log(`[gate] Auto-created MC account for ${email}`);
      } else {
        // Ensure email_verified is true if they passed gate
        await mcPool.query('UPDATE users SET email_verified = TRUE WHERE email = $1 AND email_verified = FALSE', [email.toLowerCase()]);
      }

      // Check if NDA already accepted for this site
      const ndaResult = await mcPool.query('SELECT id FROM gate_nda WHERE gate_user_id = $1 AND site = $2', [user.id, site]);
      const ndaAccepted = ndaResult.rows.length > 0;

      const token = signGateToken({ id: user.id, email: user.email, name: user.name }, { ndaAccepted });
      res.json({ token, ndaAccepted });
    } catch (err) {
      console.error('[gate] verify-code error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // POST /api/gate/accept-nda — record NDA acceptance
  app.post('/api/gate/accept-nda', requireGateAuth, gateRateLimit(5, 60_000), async (req, res) => {
    try {
      const { site } = req.body || {};
      if (!site) return res.status(400).json({ error: 'Site is required.' });
      if (!GATE_SITES[site]) return res.status(400).json({ error: 'Unknown site.' });

      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
      const userAgent = req.headers['user-agent'] || '';

      await mcPool.query(`
        INSERT INTO gate_nda (gate_user_id, site, ip, user_agent)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (gate_user_id, site) DO NOTHING
      `, [req.gateUser.id, site, ip, userAgent]);

      const token = signGateToken(
        { id: req.gateUser.id, email: req.gateUser.email, name: req.gateUser.name },
        { ndaAccepted: true }
      );
      res.json({ token });
    } catch (err) {
      console.error('[gate] accept-nda error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  });

  // GET /api/gate/session — validate existing token + NDA status
  app.get('/api/gate/session', requireGateAuth, gateRateLimit(20, 60_000), async (req, res) => {
    try {
      const site = req.query.site;
      if (!site || !GATE_SITES[site]) return res.status(400).json({ error: 'Valid site parameter required.' });

      // Update last_access
      await mcPool.query('UPDATE gate_users SET last_access = NOW() WHERE id = $1', [req.gateUser.id]);

      // Check NDA from DB (in case token is stale)
      const ndaResult = await mcPool.query('SELECT id FROM gate_nda WHERE gate_user_id = $1 AND site = $2', [req.gateUser.id, site]);
      const ndaAccepted = ndaResult.rows.length > 0;

      res.json({ valid: true, ndaAccepted, name: req.gateUser.name, email: req.gateUser.email });
    } catch (err) {
      console.error('[gate] session error:', err.message);
      res.status(500).json({ error: 'Something went wrong.' });
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

  // ---- Shared Contact Form ----

  const CONTACT_ORIGINS = new Set([
    'https://namibarden.com',
    'https://www.namibarden.com',
    'https://mastercommander.namibarden.com',
    'https://beastmode.namibarden.com',
    'http://localhost',
    'http://localhost:3000',
    'http://localhost:3457',
  ]);

  app.use('/api/contact', (req, res, next) => {
    const origin = req.headers.origin || '';
    if (CONTACT_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Rate limiter: 3 submissions per IP per 10 minutes
  const contactRateMap = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, hits] of contactRateMap) {
      const valid = hits.filter(t => now - t < 600_000);
      if (valid.length === 0) contactRateMap.delete(ip);
      else contactRateMap.set(ip, valid);
    }
  }, 300_000);

  function contactRateLimit(req, res, next) {
    const ip = req.ip;
    const now = Date.now();
    let hits = contactRateMap.get(ip) || [];
    hits = hits.filter(t => now - t < 600_000);
    if (hits.length >= 3) {
      return res.status(429).json({ error: 'Too many submissions. Please try again later.' });
    }
    hits.push(now);
    contactRateMap.set(ip, hits);
    next();
  }

  // Email routing by origin
  function getContactRouting(origin) {
    if (origin?.includes('namibarden.com') && !origin.includes('mastercommander') && !origin.includes('beastmode')) {
      return { to: 'namibarden@gmail.com', label: 'NamiBarden.com' };
    }
    if (origin?.includes('mastercommander.namibarden.com')) {
      return { to: 'overlord.gil.ai@gmail.com', label: 'Master&Commander' };
    }
    return { to: 'overlord.gil.ai@gmail.com', label: 'Contact Form' };
  }

  app.post('/api/contact', contactRateLimit, async (req, res) => {
    try {
      const { name, email, subject, message, plan, subscribe } = req.body;

      // Validate required fields
      if (!name?.trim()) return res.status(400).json({ error: 'Name is required.' });
      if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });
      if (!message?.trim()) return res.status(400).json({ error: 'Message is required.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ error: 'Invalid email address.' });
      }

      const origin = req.headers.origin || req.headers.referer || '';
      const ip = req.ip;
      const routing = getContactRouting(origin);

      // Save to DB
      try {
        await mcPool.query(
          'INSERT INTO contact_submissions (source, name, email, subject, message, plan, ip) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [routing.label, name.trim(), email.trim(), (subject || '').trim(), message.trim(), (plan || '').trim() || null, ip]
        );
      } catch (dbErr) {
        console.error('[contact] DB save error:', dbErr.message);
      }

      // If subscribe checkbox was checked, add to newsletter
      if (subscribe) {
        try {
          await mcPool.query(
            `INSERT INTO newsletter_subscribers (email, source, ip)
             VALUES ($1, 'contact-form', $2)
             ON CONFLICT (email) DO UPDATE SET
               unsubscribed_at = NULL,
               ip = EXCLUDED.ip,
               subscribed_at = CASE
                 WHEN newsletter_subscribers.unsubscribed_at IS NOT NULL THEN NOW()
                 ELSE newsletter_subscribers.subscribed_at
               END`,
            [email.trim().toLowerCase(), ip]
          );
          console.log(`[contact] Newsletter subscribe via contact form: ${email.trim()}`);
        } catch (subErr) {
          console.error('[contact] Newsletter subscribe error:', subErr.message);
        }
      }

      // Send email
      try {
        if (mcMailer) {
          const planLine = plan ? `\n<p><strong>Plan:</strong> ${plan}</p>` : '';
          await mcMailer.sendMail({
            from: `"${routing.label} Contact" <${process.env.MC_SMTP_USER}>`,
            to: routing.to,
            replyTo: email.trim(),
            subject: subject?.trim() || `New contact from ${name.trim()} — ${routing.label}`,
            html: `<h3>New Contact Form Submission</h3>
<p><strong>From:</strong> ${name.trim()} &lt;${email.trim()}&gt;</p>
<p><strong>Source:</strong> ${routing.label}</p>${planLine}
<hr>
<p>${message.trim().replace(/\n/g, '<br>')}</p>`,
          });
        } else {
          console.log(`[contact] No SMTP — ${routing.label}: ${name} <${email}> — ${message.slice(0, 100)}`);
        }
      } catch (mailErr) {
        console.error('[contact] Email send error:', mailErr.message);
      }

      // WhatsApp notification — NamiBarden contacts go to Nami, others to Gil
      try {
        const planInfo = plan ? ` | Plan: ${plan}` : '';
        const notifyJid = routing.label === 'NamiBarden.com'
          ? '84393251371@s.whatsapp.net'  // Nami
          : ADMIN_JID;                     // Gil
        await sockRef.sock.sendMessage(notifyJid, {
          text: `📬 New ${routing.label} contact:\n${name.trim()} <${email.trim()}>${planInfo}\n\n${message.trim().slice(0, 300)}`,
        });
      } catch (waErr) {
        console.error('[contact] WhatsApp notify error:', waErr.message);
      }

      res.json({ success: true, message: 'Message sent successfully!' });
    } catch (err) {
      console.error('[contact] Error:', err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  // ---- Newsletter Subscribe ----

  app.use('/api/subscribe', (req, res, next) => {
    const origin = req.headers.origin || '';
    if (CONTACT_ORIGINS.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Rate limiter: 3 subscribe attempts per IP per hour
  const subscribeRateMap = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, hits] of subscribeRateMap) {
      const valid = hits.filter(t => now - t < 3_600_000);
      if (valid.length === 0) subscribeRateMap.delete(ip);
      else subscribeRateMap.set(ip, valid);
    }
  }, 300_000);

  function subscribeRateLimit(req, res, next) {
    const ip = req.ip;
    const now = Date.now();
    let hits = subscribeRateMap.get(ip) || [];
    hits = hits.filter(t => now - t < 3_600_000);
    if (hits.length >= 3) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }
    hits.push(now);
    subscribeRateMap.set(ip, hits);
    next();
  }

  app.post('/api/subscribe', subscribeRateLimit, async (req, res) => {
    try {
      const { email } = req.body;

      if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        return res.status(400).json({ error: 'Invalid email address.' });
      }

      const ip = req.ip;
      const trimmed = email.trim().toLowerCase();

      // Upsert — reactivate if previously unsubscribed, ignore if already active
      let isNew = false;
      try {
        const result = await mcPool.query(
          `INSERT INTO newsletter_subscribers (email, source, ip)
           VALUES ($1, 'newsletter-form', $2)
           ON CONFLICT (email) DO UPDATE SET
             unsubscribed_at = NULL,
             ip = EXCLUDED.ip,
             subscribed_at = CASE
               WHEN newsletter_subscribers.unsubscribed_at IS NOT NULL THEN NOW()
               ELSE newsletter_subscribers.subscribed_at
             END
           RETURNING (xmax = 0) AS inserted`,
          [trimmed, ip]
        );
        isNew = result.rows[0]?.inserted;
      } catch (dbErr) {
        console.error('[subscribe] DB save error:', dbErr.message);
        return res.status(500).json({ error: 'Something went wrong. Please try again.' });
      }

      // WhatsApp notification to Nami — only for genuinely new subscribers
      if (isNew) {
        try {
          await sockRef.sock.sendMessage('84393251371@s.whatsapp.net', {
            text: `📬 New newsletter subscriber: ${trimmed}`,
          });
        } catch (waErr) {
          console.error('[subscribe] WhatsApp notify error:', waErr.message);
        }
        console.log(`[subscribe] New subscriber: ${trimmed}`);
      } else {
        console.log(`[subscribe] Already subscribed: ${trimmed}`);
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[subscribe] Error:', err.message);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });

  app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP API listening on port ${WEBHOOK_PORT}`);
  });

  return app;
}
