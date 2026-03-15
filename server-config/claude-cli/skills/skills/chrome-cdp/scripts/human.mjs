#!/usr/bin/env -S node --experimental-websocket
// human.mjs — Human-like browser interactions via CDP
// Bezier mouse curves, realistic typing, natural scrolling
// Uses the same DevToolsActivePort / daemon as cdp.mjs

import { readFileSync, existsSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { resolve } from 'path';
import net from 'net';

const SOCK_PREFIX = '/tmp/cdp-';
const PAGES_CACHE = '/tmp/cdp-pages.json';

// ---------------------------------------------------------------------------
// Bezier math
// ---------------------------------------------------------------------------

function lerp(a, b, t) { return a + (b - a) * t; }

function cubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
  };
}

function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }

// Generate human-like control points for bezier curve
function generateControlPoints(start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Perpendicular offset scaled by distance (more curve for longer paths)
  const spread = Math.min(dist * 0.3, 150);

  const cp1 = {
    x: start.x + dx * rand(0.2, 0.4) + rand(-spread, spread),
    y: start.y + dy * rand(0.2, 0.4) + rand(-spread, spread),
  };
  const cp2 = {
    x: start.x + dx * rand(0.6, 0.8) + rand(-spread, spread),
    y: start.y + dy * rand(0.6, 0.8) + rand(-spread, spread),
  };

  return { cp1, cp2 };
}

// Generate points along bezier with easing (slow start/end, fast middle)
function generatePath(start, end, steps) {
  const { cp1, cp2 } = generateControlPoints(start, end);
  const points = [];

  for (let i = 0; i <= steps; i++) {
    // Ease in-out: slow at start and end
    let t = i / steps;
    t = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const pt = cubicBezier(start, cp1, cp2, end, t);
    // Add micro-jitter (1-2px) for realism
    points.push({
      x: Math.round(pt.x + rand(-1.5, 1.5)),
      y: Math.round(pt.y + rand(-1.5, 1.5)),
    });
  }

  // Ensure last point is exact target
  points[points.length - 1] = { x: Math.round(end.x), y: Math.round(end.y) };
  return points;
}

// ---------------------------------------------------------------------------
// CDP daemon IPC (reuse from cdp.mjs)
// ---------------------------------------------------------------------------

function connectToSocket(sp) {
  return new Promise((resolve, reject) => {
    const conn = net.connect(sp);
    conn.on('connect', () => resolve(conn));
    conn.on('error', reject);
  });
}

function sendCommand(conn, req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    let settled = false;
    const cleanup = () => { conn.off('data', onData); conn.off('error', onError); conn.off('end', onEnd); };
    const onData = (chunk) => {
      buf += chunk.toString();
      const idx = buf.indexOf('\n');
      if (idx === -1) return;
      settled = true; cleanup();
      resolve(JSON.parse(buf.slice(0, idx)));
      conn.end();
    };
    const onError = (e) => { if (!settled) { settled = true; cleanup(); reject(e); } };
    const onEnd = () => { if (!settled) { settled = true; cleanup(); reject(new Error('closed')); } };
    conn.on('data', onData);
    conn.on('error', onError);
    conn.on('end', onEnd);
    req.id = 1;
    conn.write(JSON.stringify(req) + '\n');
  });
}

function findDaemonSocket(targetPrefix) {
  const sockets = readdirSync('/tmp')
    .filter(f => f.startsWith('cdp-') && f.endsWith('.sock'))
    .map(f => ({ targetId: f.slice(4, -5), path: `/tmp/${f}` }));

  if (!targetPrefix) return sockets[0]?.path;

  const upper = targetPrefix.toUpperCase();
  const match = sockets.find(s => s.targetId.toUpperCase().startsWith(upper));
  return match?.path;
}

function resolveTarget(prefix) {
  // Try daemon sockets first
  const sp = findDaemonSocket(prefix);
  if (sp) return sp;

  // Fall back to pages cache
  if (!existsSync(PAGES_CACHE)) {
    throw new Error('No daemon running. Run "cdp.mjs list" first.');
  }
  const pages = JSON.parse(readFileSync(PAGES_CACHE, 'utf8'));
  const upper = prefix.toUpperCase();
  const match = pages.find(p => p.targetId.toUpperCase().startsWith(upper));
  if (!match) throw new Error(`No target matching "${prefix}"`);
  return `${SOCK_PREFIX}${match.targetId}.sock`;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Human-like actions
// ---------------------------------------------------------------------------

// Track current mouse position
let cursorX = randInt(400, 600);
let cursorY = randInt(300, 500);

async function humanMove(sockPath, x, y) {
  const start = { x: cursorX, y: cursorY };
  const end = { x, y };
  const dist = Math.sqrt((end.x - start.x) ** 2 + (end.y - start.y) ** 2);

  // More steps for longer distances (20-80 steps)
  const steps = Math.max(20, Math.min(80, Math.round(dist / 8)));
  const points = generatePath(start, end, steps);

  // Total duration: 200-600ms depending on distance
  const totalMs = Math.max(200, Math.min(600, dist * 1.5));
  const stepDelay = totalMs / steps;

  for (const pt of points) {
    const conn = await connectToSocket(sockPath);
    await sendCommand(conn, {
      cmd: 'evalraw',
      args: ['Input.dispatchMouseEvent', JSON.stringify({
        type: 'mouseMoved', x: pt.x, y: pt.y
      })]
    });
    await sleep(stepDelay + rand(-2, 2));
  }

  cursorX = x;
  cursorY = y;
  return `Moved to (${x}, ${y}) in ${steps} steps over ${Math.round(totalMs)}ms`;
}

async function humanClick(sockPath, x, y) {
  // Move to target first
  await humanMove(sockPath, x, y);

  // Small pause before clicking (human reaction)
  await sleep(rand(50, 150));

  // Mouse down
  const conn1 = await connectToSocket(sockPath);
  await sendCommand(conn1, {
    cmd: 'evalraw',
    args: ['Input.dispatchMouseEvent', JSON.stringify({
      type: 'mousePressed', x, y, button: 'left', clickCount: 1
    })]
  });

  // Hold for 50-120ms (human click duration)
  await sleep(rand(50, 120));

  // Mouse up
  const conn2 = await connectToSocket(sockPath);
  await sendCommand(conn2, {
    cmd: 'evalraw',
    args: ['Input.dispatchMouseEvent', JSON.stringify({
      type: 'mouseReleased', x, y, button: 'left', clickCount: 1
    })]
  });

  return `Human-clicked at (${x}, ${y})`;
}

async function humanClickSelector(sockPath, selector) {
  // Get element center coordinates
  const conn = await connectToSocket(sockPath);
  const resp = await sendCommand(conn, {
    cmd: 'eval',
    args: [`(function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return JSON.stringify({error: 'not found'});
      el.scrollIntoView({block: 'center', behavior: 'smooth'});
      var r = el.getBoundingClientRect();
      return JSON.stringify({
        x: Math.round(r.x + r.width * (0.3 + Math.random() * 0.4)),
        y: Math.round(r.y + r.height * (0.3 + Math.random() * 0.4)),
        tag: el.tagName, text: el.textContent.trim().substring(0, 50)
      });
    })()`]
  });

  if (!resp.ok) throw new Error(resp.error);
  const info = JSON.parse(resp.result);
  if (info.error) throw new Error(`Element not found: ${selector}`);

  // Wait for scroll to settle
  await sleep(rand(200, 400));

  await humanClick(sockPath, info.x, info.y);
  return `Human-clicked <${info.tag}> "${info.text}" at (${info.x}, ${info.y})`;
}

async function humanType(sockPath, text) {
  const chars = [...text];
  let typed = 0;

  for (const char of chars) {
    const conn = await connectToSocket(sockPath);
    await sendCommand(conn, {
      cmd: 'evalraw',
      args: ['Input.dispatchKeyEvent', JSON.stringify({
        type: 'keyDown', text: char
      })]
    });

    const conn2 = await connectToSocket(sockPath);
    await sendCommand(conn2, {
      cmd: 'evalraw',
      args: ['Input.dispatchKeyEvent', JSON.stringify({
        type: 'keyUp'
      })]
    });

    typed++;

    // Variable delay: 40-150ms base, occasional longer pauses
    let delay = rand(40, 150);

    // 8% chance of a "thinking pause" (200-500ms)
    if (Math.random() < 0.08) delay = rand(200, 500);

    // Slightly faster for common letter sequences
    if (typed > 2 && Math.random() < 0.3) delay *= 0.7;

    await sleep(delay);
  }

  return `Human-typed ${typed} chars: "${text.substring(0, 40)}${text.length > 40 ? '...' : ''}"`;
}

async function humanScroll(sockPath, deltaY, x, y) {
  const scrollX = x || cursorX;
  const scrollY = y || cursorY;
  const steps = randInt(3, 6);
  const perStep = deltaY / steps;

  for (let i = 0; i < steps; i++) {
    const conn = await connectToSocket(sockPath);
    await sendCommand(conn, {
      cmd: 'evalraw',
      args: ['Input.dispatchMouseEvent', JSON.stringify({
        type: 'mouseWheel', x: scrollX, y: scrollY,
        deltaX: 0, deltaY: Math.round(perStep + rand(-10, 10))
      })]
    });
    await sleep(rand(30, 80));
  }

  return `Human-scrolled ${deltaY}px in ${steps} steps`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `human.mjs — Human-like browser interactions via CDP

Usage: human.mjs <target> <command> [args]

Commands:
  move    <x> <y>              Move cursor with bezier path
  click   <x> <y>              Move + click at coordinates
  clickel <selector>           Move + click element by CSS selector
  type    <text>               Type with human-like delays
  scroll  <deltaY> [x] [y]    Scroll with natural steps
  wait    <min_ms> <max_ms>    Random human pause

<target> is a targetId prefix from "cdp.mjs list".

Examples:
  human.mjs DC8A click 780 249
  human.mjs DC8A clickel "button.submit"
  human.mjs DC8A type "hello world"
  human.mjs DC8A scroll 300
  human.mjs DC8A wait 1000 3000
`;

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2 || args[0] === '--help' || args[0] === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  const [targetPrefix, cmd, ...rest] = args;
  const sockPath = resolveTarget(targetPrefix);

  try {
    let result;
    switch (cmd) {
      case 'move':
        result = await humanMove(sockPath, parseFloat(rest[0]), parseFloat(rest[1]));
        break;
      case 'click':
        result = await humanClick(sockPath, parseFloat(rest[0]), parseFloat(rest[1]));
        break;
      case 'clickel':
        result = await humanClickSelector(sockPath, rest[0]);
        break;
      case 'type':
        result = await humanType(sockPath, rest.join(' '));
        break;
      case 'scroll':
        result = await humanScroll(sockPath, parseFloat(rest[0]), rest[1] ? parseFloat(rest[1]) : undefined, rest[2] ? parseFloat(rest[2]) : undefined);
        break;
      case 'wait': {
        const ms = randInt(parseInt(rest[0]) || 1000, parseInt(rest[1]) || 3000);
        await sleep(ms);
        result = `Waited ${ms}ms`;
        break;
      }
      default:
        console.error(`Unknown command: ${cmd}`);
        console.log(USAGE);
        process.exit(1);
    }
    console.log(result);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
