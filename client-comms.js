/**
 * Client Communication Automation (#8) — Email templates + triggers
 *
 * Templates for incidents, payment recovery, re-engagement.
 * WhatsApp approval flow: draft → Gil approves → send.
 * /draft <type> <to> command
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import pino from 'pino';

const execAsync = promisify(exec);
const logger = pino({ level: 'info' });

const PENDING_FILE = '/app/data/pending-drafts.json';

const TEMPLATES = {
  'payment-recovery': {
    subject: 'Quick heads up about your payment',
    body: (vars) => `Hi ${vars.name || 'there'},

Just wanted to let you know that your recent payment of $${vars.amount || '?'} didn't go through. This usually happens when a card expires or has insufficient funds — easy fix.

You can update your payment method at ${vars.url || 'namibarden.com'}, or just reply here and I'll help.

Cheers,
Gil`,
  },
  'incident': {
    subject: (vars) => `Service update: ${vars.service || 'our platform'}`,
    body: (vars) => `Hi ${vars.name || 'there'},

Wanted to give you a quick update — we experienced a brief ${vars.issue || 'service interruption'} today affecting ${vars.service || 'the platform'}.

${vars.resolved ? 'Everything is back to normal now.' : 'We\'re actively working on resolving this.'}
${vars.details ? `\nDetails: ${vars.details}` : ''}

Sorry for any inconvenience. If you notice anything off, just reply here.

Thanks for your patience,
Gil`,
  },
  're-engagement': {
    subject: 'We miss you!',
    body: (vars) => `Hey ${vars.name || 'there'},

Haven't seen you in a while on ${vars.platform || 'the platform'} and wanted to check in.

${vars.offer ? `Here's something that might interest you: ${vars.offer}` : 'Is there anything I can help with or any feedback you\'d like to share?'}

Hope to see you back soon!

Gil`,
  },
  'welcome': {
    subject: 'Welcome aboard!',
    body: (vars) => `Hey ${vars.name || 'there'}!

Welcome to ${vars.platform || 'NamiBarden'}! Excited to have you.

${vars.nextSteps || 'To get started, check out your dashboard and explore the courses available.'}

If you have any questions, just reply to this email — I personally read every one.

Cheers,
Gil`,
  },
};

export function getTemplateNames() {
  return Object.keys(TEMPLATES);
}

export function buildDraft(templateName, vars = {}) {
  const template = TEMPLATES[templateName];
  if (!template) return null;

  return {
    to: vars.to || vars.email,
    subject: typeof template.subject === 'function' ? template.subject(vars) : template.subject,
    body: template.body(vars),
    template: templateName,
    vars,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

export function savePendingDraft(draft) {
  const drafts = loadPendingDrafts();
  draft.id = `draft-${Date.now()}`;
  drafts.push(draft);
  writeFileSync(PENDING_FILE, JSON.stringify(drafts, null, 2));
  return draft.id;
}

export function loadPendingDrafts() {
  try {
    return JSON.parse(readFileSync(PENDING_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

export function getPendingDraft(id) {
  const drafts = loadPendingDrafts();
  return drafts.find(d => d.id === id);
}

export function removePendingDraft(id) {
  const drafts = loadPendingDrafts();
  const filtered = drafts.filter(d => d.id !== id);
  writeFileSync(PENDING_FILE, JSON.stringify(filtered, null, 2));
}

export async function sendDraft(draft) {
  if (!draft || !draft.to || !draft.body) throw new Error('Invalid draft');

  // Build RFC 2822 email via gws
  const escapedBody = draft.body.replace(/'/g, "'\\''");
  const escapedSubject = (draft.subject || 'No subject').replace(/'/g, "'\\''");

  try {
    await execAsync(
      `gws gmail users messages send --params '{"userId":"me"}' --body '{"raw":"'$(echo "To: ${draft.to}\nSubject: ${escapedSubject}\nContent-Type: text/plain; charset=utf-8\n\n${escapedBody}" | base64 -w 0)'"}'`,
      { timeout: 15000 }
    );
    logger.info({ to: draft.to, template: draft.template }, 'Email sent');
    return true;
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to send email');
    throw err;
  }
}

export function formatDraftPreview(draft) {
  return [
    `📧 *Draft Email* (${draft.id})`,
    `To: ${draft.to}`,
    `Subject: ${draft.subject}`,
    '',
    draft.body,
    '',
    '_Reply "send it" to send, or "edit: [changes]" to modify._',
  ].join('\n');
}

export function formatPendingDrafts() {
  const drafts = loadPendingDrafts();
  if (drafts.length === 0) return 'No pending drafts.';
  return drafts.map(d =>
    `${d.id}: To ${d.to} — "${d.subject}" (${d.template})`
  ).join('\n');
}
