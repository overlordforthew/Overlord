/**
 * server.js — HTTP API for proactive notifications and webhooks
 * Runs alongside Baileys WhatsApp connection on a separate port.
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
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

  app.listen(WEBHOOK_PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP API listening on port ${WEBHOOK_PORT}`);
  });

  return app;
}
