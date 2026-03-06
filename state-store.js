/**
 * State Store — Per-chat active state for agentic continuity
 *
 * Keeps track of what Overlord is working on per chat.
 * Also manages standing orders (persistent behavioral rules).
 *
 * data/chat-states.json — live per-chat state
 * data/standing-orders.json — persistent behavioral rules
 */

import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';

const DATA_DIR = process.env.DATA_DIR || './data';
const STATES_FILE = path.join(DATA_DIR, 'chat-states.json');
const STANDING_ORDERS_FILE = path.join(DATA_DIR, 'standing-orders.json');

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function now() {
  return new Date().toISOString();
}

// ============================================================
// CHAT STATE
// ============================================================

async function readStates() {
  try {
    const data = await fs.readFile(STATES_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function writeStates(states) {
  ensureDir(DATA_DIR);
  const tmp = STATES_FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(states, null, 2));
  await fs.rename(tmp, STATES_FILE);
}

/**
 * Get the current state for a chat.
 * Returns defaults if no state exists yet.
 */
export async function getChatState(chatJid) {
  const states = await readStates();
  return states[chatJid] || {
    activeTaskId: null,
    awaitingConfirmation: false,
    lastQuestion: null,
    lastOperationalTopic: null,
    lastActionTaken: null,
    lastSeenError: null,
    updatedAt: null,
  };
}

/**
 * Update fields in a chat's state (merged, not replaced).
 */
export async function setChatState(chatJid, updates) {
  const states = await readStates();
  states[chatJid] = {
    ...(states[chatJid] || {}),
    ...updates,
    updatedAt: now(),
  };
  await writeStates(states);
  return states[chatJid];
}

/**
 * Clear active task and confirmation state (e.g., after task completes or /clear).
 */
export async function clearChatState(chatJid) {
  return await setChatState(chatJid, {
    activeTaskId: null,
    awaitingConfirmation: false,
    lastQuestion: null,
    lastOperationalTopic: null,
    lastActionTaken: null,
    lastSeenError: null,
  });
}

// ============================================================
// STANDING ORDERS
// ============================================================

/**
 * Standing orders are persistent behavioral rules Gil sets.
 * Examples:
 *   "Always verify prod URL after every deploy"
 *   "Never notify me for transient errors that auto-resolve"
 *   "repair means: check the last error in logs, fix it, verify it"
 */
export async function getStandingOrders() {
  try {
    const data = await fs.readFile(STANDING_ORDERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function addStandingOrder(rule) {
  const orders = await getStandingOrders();
  const id = Date.now().toString(36);
  orders.push({ id, rule, addedAt: now() });
  ensureDir(DATA_DIR);
  await fs.writeFile(STANDING_ORDERS_FILE, JSON.stringify(orders, null, 2));
  return id;
}

export async function removeStandingOrder(id) {
  const orders = await getStandingOrders();
  const filtered = orders.filter(o => o.id !== id);
  if (filtered.length === orders.length) return false;
  await fs.writeFile(STANDING_ORDERS_FILE, JSON.stringify(filtered, null, 2));
  return true;
}

/**
 * Format standing orders for injection into system prompt.
 */
export function formatStandingOrders(orders) {
  if (!orders || orders.length === 0) return '';
  return 'STANDING ORDERS (always follow these):\n' + orders.map(o => `- ${o.rule}`).join('\n');
}

/**
 * Format standing orders for display in WhatsApp.
 */
export function formatStandingOrdersList(orders) {
  if (!orders || orders.length === 0) return 'No standing orders set.';
  return orders.map((o, i) => `${i + 1}. [${o.id}] ${o.rule}`).join('\n');
}
