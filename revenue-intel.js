/**
 * Revenue Intelligence (#3) — Stripe deep integration
 *
 * Daily revenue dashboard, failed payment detection, churn alerts.
 * Auto-drafts recovery emails for failed payments.
 * /revenue command
 */

import pino from 'pino';
import { readFileSync } from 'fs';

const logger = pino({ level: 'info' });

let stripe = null;

function getStripeKey() {
  try {
    const env = readFileSync('/projects/NamiBarden/.env', 'utf-8');
    const match = env.match(/STRIPE_SECRET_KEY=(\S+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

async function ensureStripe() {
  if (stripe) return stripe;
  const key = getStripeKey();
  if (!key) throw new Error('Stripe key not found in NamiBarden .env');
  const Stripe = (await import('stripe')).default;
  stripe = new Stripe(key);
  return stripe;
}

export async function getDailyRevenue() {
  const s = await ensureStripe();
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 86400;
  const weekAgo = now - 604800;
  const monthAgo = now - 2592000;

  // Single API call — slice locally for today/week/month
  const allCharges = await s.charges.list({ created: { gte: monthAgo }, limit: 100 });

  const sumAndCount = (charges, since) => {
    const filtered = charges.filter(c => c.paid && !c.refunded && c.created >= since);
    return { amount: filtered.reduce((acc, c) => acc + c.amount, 0) / 100, count: filtered.length };
  };

  return {
    today: sumAndCount(allCharges.data, dayAgo),
    week: sumAndCount(allCharges.data, weekAgo),
    month: sumAndCount(allCharges.data, monthAgo),
  };
}

export async function getFailedPayments() {
  const s = await ensureStripe();
  const weekAgo = Math.floor(Date.now() / 1000) - 604800;

  const charges = await s.charges.list({
    created: { gte: weekAgo },
    limit: 50,
  });

  return charges.data
    .filter(c => c.status === 'failed' || (c.outcome && c.outcome.type === 'blocked'))
    .map(c => ({
      id: c.id,
      amount: (c.amount / 100).toFixed(2),
      currency: c.currency.toUpperCase(),
      email: c.billing_details?.email || c.receipt_email || 'unknown',
      reason: c.failure_message || c.outcome?.reason || 'unknown',
      date: new Date(c.created * 1000).toLocaleDateString(),
    }));
}

export async function getSubscriptions() {
  const s = await ensureStripe();

  const [active, canceled, pastDue] = await Promise.all([
    s.subscriptions.list({ status: 'active', limit: 100 }),
    s.subscriptions.list({ status: 'canceled', limit: 20, created: { gte: Math.floor(Date.now() / 1000) - 2592000 } }),
    s.subscriptions.list({ status: 'past_due', limit: 50 }),
  ]);

  return {
    active: active.data.length,
    canceled: canceled.data.length,
    pastDue: pastDue.data.map(sub => ({
      id: sub.id,
      email: sub.customer,
      amount: sub.items.data[0]?.price?.unit_amount ? (sub.items.data[0].price.unit_amount / 100).toFixed(2) : '?',
      daysPastDue: Math.round((Date.now() / 1000 - sub.current_period_end) / 86400),
    })),
  };
}

export async function getRecentCustomers(limit = 5) {
  const s = await ensureStripe();
  const customers = await s.customers.list({ limit, expand: ['data.subscriptions'] });
  return customers.data.map(c => ({
    email: c.email,
    name: c.name,
    created: new Date(c.created * 1000).toLocaleDateString(),
    subscriptions: c.subscriptions?.data?.length || 0,
  }));
}

export async function formatRevenueDashboard() {
  try {
    const [revenue, failed, subs, recent] = await Promise.all([
      getDailyRevenue(),
      getFailedPayments(),
      getSubscriptions(),
      getRecentCustomers(5),
    ]);

    const lines = ['💰 *Revenue Dashboard (NamiBarden)*\n'];

    lines.push('*Revenue:*');
    lines.push(`  Today: $${revenue.today.amount.toFixed(2)} (${revenue.today.count} charges)`);
    lines.push(`  This week: $${revenue.week.amount.toFixed(2)} (${revenue.week.count})`);
    lines.push(`  This month: $${revenue.month.amount.toFixed(2)} (${revenue.month.count})`);

    lines.push('\n*Subscriptions:*');
    lines.push(`  Active: ${subs.active} | Canceled (30d): ${subs.canceled} | Past due: ${subs.pastDue.length}`);

    if (subs.pastDue.length > 0) {
      lines.push('\n*Past Due:*');
      for (const sub of subs.pastDue.slice(0, 5)) {
        lines.push(`  ${sub.email} — $${sub.amount} (${sub.daysPastDue} days overdue)`);
      }
    }

    if (failed.length > 0) {
      lines.push('\n*Failed Payments (7d):*');
      for (const f of failed.slice(0, 5)) {
        lines.push(`  ${f.email} — $${f.amount} ${f.currency} — ${f.reason} (${f.date})`);
      }
    }

    if (recent.length > 0) {
      lines.push('\n*Recent Customers:*');
      for (const c of recent) {
        lines.push(`  ${c.name || c.email} — joined ${c.created}`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    return `❌ Revenue dashboard failed: ${err.message}`;
  }
}

export function buildRecoveryEmailDraft(failedPayment) {
  return {
    to: failedPayment.email,
    subject: 'Quick heads up about your payment',
    body: `Hi there,

Just wanted to let you know that your recent payment of $${failedPayment.amount} ${failedPayment.currency} didn't go through.

This can happen when a card expires or has insufficient funds — no worries, it's easily fixed.

You can update your payment method here or just reply to this email and I'll help sort it out.

Thanks!
Gil`,
  };
}
