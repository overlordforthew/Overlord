/**
 * Multi-Bot Orchestration (#4) — Coordinate SurfaBabe and future bots
 *
 * Monitors SurfaBabe health, receives escalations, pushes fixes.
 * /fleet command for status overview.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import pino from 'pino';

const execAsync = promisify(exec);
const logger = pino({ level: 'info' });

const BOTS = {
  surfababe: {
    name: 'SurfaBabe',
    container: 'surfababe',
    dbContainer: 'surfababe-db',
    projectPath: '/projects/SurfaBabe',
    url: 'https://surfababe.namibarden.com',
    admin: 'Ailie',
  },
};

export async function getFleetStatus() {
  const status = {};

  for (const [key, bot] of Object.entries(BOTS)) {
    const info = { name: bot.name, admin: bot.admin, status: 'unknown', uptime: null, errors: [] };

    // Run all 4 checks in parallel (independent docker commands)
    const [containerResult, errorsResult, dbResult, escalationsResult] = await Promise.allSettled([
      execAsync(`docker inspect --format='{{.State.Status}} {{.State.StartedAt}}' ${bot.container} 2>/dev/null`, { timeout: 5000 }),
      execAsync(`docker logs ${bot.container} --tail 100 2>&1 | grep -i "error\\|fatal\\|crash\\|SIGTERM" | tail -5`, { timeout: 10000 }),
      execAsync(`docker inspect --format='{{.State.Status}}' ${bot.dbContainer} 2>/dev/null`, { timeout: 5000 }),
      execAsync(`docker logs ${bot.container} --tail 200 2>&1 | grep -i "overlord\\|escalat\\|need help\\|stuck" | tail -3`, { timeout: 10000 }),
    ]);

    if (containerResult.status === 'fulfilled') {
      const [state, started] = containerResult.value.stdout.trim().split(' ');
      info.status = state;
      if (state === 'running') {
        const upMs = Date.now() - new Date(started).getTime();
        info.uptime = `${Math.round(upMs / 3600000)}h`;
      }
    } else {
      info.status = 'not found';
    }

    if (errorsResult.status === 'fulfilled' && errorsResult.value.stdout.trim()) {
      info.errors = errorsResult.value.stdout.trim().split('\n').map(l => l.substring(0, 150));
    }

    info.dbStatus = dbResult.status === 'fulfilled' ? dbResult.value.stdout.trim() : 'not found';

    if (escalationsResult.status === 'fulfilled' && escalationsResult.value.stdout.trim()) {
      info.escalations = escalationsResult.value.stdout.trim().split('\n').map(l => l.substring(0, 200));
    }

    status[key] = info;
  }

  return status;
}

export async function pushFixToBot(botKey, filePath, containerPath) {
  const bot = BOTS[botKey];
  if (!bot) throw new Error(`Unknown bot: ${botKey}`);

  await execAsync(
    `docker cp "${filePath}" ${bot.container}:${containerPath}`,
    { timeout: 15000 }
  );
  logger.info({ bot: botKey, file: filePath, dest: containerPath }, 'Pushed fix to bot');
}

export async function restartBot(botKey) {
  const bot = BOTS[botKey];
  if (!bot) throw new Error(`Unknown bot: ${botKey}`);

  await execAsync(`docker restart ${bot.container}`, { timeout: 30000 });
  logger.info({ bot: botKey }, 'Bot restarted');
}

export async function getBotLogs(botKey, lines = 50) {
  const bot = BOTS[botKey];
  if (!bot) throw new Error(`Unknown bot: ${botKey}`);

  const { stdout } = await execAsync(
    `docker logs ${bot.container} --tail ${lines} 2>&1`,
    { timeout: 10000 }
  );
  return stdout;
}

export function formatFleetStatus(status) {
  const lines = ['🤖 *Bot Fleet Status*\n'];

  for (const [key, info] of Object.entries(status)) {
    const statusEmoji = info.status === 'running' ? '🟢' : '🔴';
    lines.push(`${statusEmoji} *${info.name}* (${info.admin})`);
    lines.push(`  Status: ${info.status}${info.uptime ? ` (up ${info.uptime})` : ''}`);
    lines.push(`  DB: ${info.dbStatus || 'unknown'}`);

    if (info.errors?.length) {
      lines.push(`  ⚠️ Recent errors: ${info.errors.length}`);
      lines.push(`  Last: ${info.errors[info.errors.length - 1].substring(0, 100)}`);
    }

    if (info.escalations?.length) {
      lines.push(`  📢 Escalations: ${info.escalations.length}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// Track failed restart attempts to avoid spamming alerts
const _fleetAlertState = {};

export async function checkFleetHealth(sendAlert) {
  const status = await getFleetStatus();

  for (const [key, info] of Object.entries(status)) {
    if (info.status !== 'running') {
      const state = _fleetAlertState[key] || { failures: 0, lastAlert: 0 };
      // Only alert on first failure or every 30 minutes after
      const timeSinceLastAlert = Date.now() - state.lastAlert;
      if (state.failures === 0 || timeSinceLastAlert > 30 * 60 * 1000) {
        await sendAlert(`🔴 *Fleet Alert:* ${info.name} is ${info.status}. Auto-restarting...`);
        try {
          await restartBot(key);
          await sendAlert(`🟢 ${info.name} restarted successfully.`);
          delete _fleetAlertState[key];
          continue;
        } catch (err) {
          await sendAlert(`❌ Failed to restart ${info.name}: ${err.message}`);
        }
        state.lastAlert = Date.now();
      }
      state.failures++;
      _fleetAlertState[key] = state;
    } else {
      delete _fleetAlertState[key];
    }
  }
}
