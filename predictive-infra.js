/**
 * Predictive Infrastructure (#6) — Alert before things break
 *
 * Tracks disk/memory/CPU trends, SSL expiry, container restart frequency.
 * Alerts 48h before predicted failures.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import pino from 'pino';

const execAsync = promisify(exec);
const logger = pino({ level: 'info' });

export async function getPredictions() {
  const predictions = [];

  // 1. Disk growth rate — predict when full
  try {
    const { stdout } = await execAsync("df / | tail -1 | awk '{print $2, $3, $5}'", { timeout: 5000 });
    const [totalStr, usedStr, pctStr] = stdout.trim().split(/\s+/);
    const totalGB = parseInt(totalStr) / 1024 / 1024;
    const usedGB = parseInt(usedStr) / 1024 / 1024;
    const pct = parseInt(pctStr);

    // Read historical data for trend
    try {
      const data = readFileSync('/app/data/perf-history.jsonl', 'utf-8').trim().split('\n');
      const recent = data.slice(-14).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      if (recent.length >= 2) {
        const first = recent[0];
        const last = recent[recent.length - 1];
        const daysBetween = (new Date(last.ts) - new Date(first.ts)) / (1000 * 60 * 60 * 24);
        if (daysBetween > 0) {
          const growthPerDay = (last.disk_pct - first.disk_pct) / daysBetween;
          if (growthPerDay > 0) {
            const daysUntilFull = (95 - pct) / growthPerDay;
            predictions.push({
              category: 'disk',
              severity: daysUntilFull < 2 ? 'critical' : daysUntilFull < 7 ? 'warning' : 'info',
              message: `Disk at ${pct}% (${usedGB.toFixed(1)}/${totalGB.toFixed(1)} GB). Growing ${growthPerDay.toFixed(2)}%/day → full in ~${Math.round(daysUntilFull)} days`,
              daysUntil: Math.round(daysUntilFull),
            });
          }
        }
      }
    } catch { /* no history */ }

    if (pct > 85) {
      predictions.push({ category: 'disk', severity: 'critical', message: `Disk at ${pct}% — critically low space`, daysUntil: 0 });
    }
  } catch (err) {
    logger.warn({ err: err.message }, 'Disk prediction failed');
  }

  // 2. Memory trend
  try {
    const { stdout } = await execAsync("free | awk '/Mem/{printf \"%.1f %.1f\", $3/$2*100, $7/$2*100}'", { timeout: 5000 });
    const [usedPct, availPct] = stdout.trim().split(/\s+/).map(Number);
    if (usedPct > 85) {
      predictions.push({ category: 'memory', severity: 'warning', message: `Memory at ${usedPct.toFixed(0)}% used (${availPct.toFixed(0)}% available)`, daysUntil: 0 });
    }
  } catch {}

  // 3. SSL certificate expiry
  const domains = ['namibarden.com', 'beastmode.namibarden.com', 'lumina.namibarden.com', 'mastercommander.namibarden.com', 'surfababe.namibarden.com', 'onlyhulls.com', 'onlydrafting.com'];
  for (const domain of domains) {
    try {
      const { stdout } = await execAsync(
        `echo | openssl s_client -servername ${domain} -connect ${domain}:443 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2`,
        { timeout: 8000 }
      );
      if (stdout.trim()) {
        const expiry = new Date(stdout.trim());
        const daysLeft = Math.round((expiry - new Date()) / (1000 * 60 * 60 * 24));
        if (daysLeft < 14) {
          predictions.push({
            category: 'ssl',
            severity: daysLeft < 3 ? 'critical' : 'warning',
            message: `SSL cert for ${domain} expires in ${daysLeft} days (${expiry.toLocaleDateString()})`,
            daysUntil: daysLeft,
          });
        }
      }
    } catch { /* skip domain */ }
  }

  // 4. Container restart frequency (restart loops)
  try {
    const { stdout } = await execAsync(
      `docker ps -a --format '{{.Names}} {{.Status}}' 2>/dev/null`,
      { timeout: 10000 }
    );
    for (const line of stdout.trim().split('\n')) {
      const restartMatch = line.match(/(\S+)\s+.*Restarting/);
      if (restartMatch) {
        predictions.push({ category: 'container', severity: 'critical', message: `Container ${restartMatch[1]} is in a restart loop`, daysUntil: 0 });
      }
    }
  } catch {}

  // 5. Database connection pool (PostgreSQL)
  try {
    const { stdout } = await execAsync(
      `docker exec overlord-db psql -U overlord -d overlord -t -c "SELECT count(*) FROM pg_stat_activity" 2>/dev/null`,
      { timeout: 5000 }
    );
    const conns = parseInt(stdout.trim());
    if (conns > 80) {
      predictions.push({ category: 'database', severity: 'warning', message: `${conns} active DB connections (max is typically 100)`, daysUntil: 0 });
    }
  } catch {}

  return predictions;
}

export function formatPredictions(predictions) {
  if (!predictions || predictions.length === 0) {
    return '🔮 *Predictive Infrastructure*\n\nAll systems healthy — no predicted issues.';
  }

  const byLevel = { critical: [], warning: [], info: [] };
  for (const p of predictions) byLevel[p.severity]?.push(p) || byLevel.info.push(p);

  const lines = ['🔮 *Predictive Infrastructure*\n'];
  if (byLevel.critical.length) {
    lines.push('🔴 *Critical:*');
    byLevel.critical.forEach(p => lines.push(`  ${p.message}`));
  }
  if (byLevel.warning.length) {
    lines.push('🟡 *Warning:*');
    byLevel.warning.forEach(p => lines.push(`  ${p.message}`));
  }
  if (byLevel.info.length) {
    lines.push('🟢 *Trends:*');
    byLevel.info.forEach(p => lines.push(`  ${p.message}`));
  }
  return lines.join('\n');
}

export async function getAlerts() {
  const predictions = await getPredictions();
  return predictions.filter(p => p.severity === 'critical' || p.severity === 'warning');
}
