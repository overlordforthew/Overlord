/**
 * Multi-Server Expansion (#10) — Cross-server management via Tailscale
 *
 * Manage remote servers (Elmo, future clients) from Overlord.
 * SSH over Tailscale for commands, monitoring, deploys.
 * /server <name> <command>
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import pino from 'pino';

const execAsync = promisify(exec);
const logger = pino({ level: 'info' });

const SERVERS = {
  elmo: {
    name: 'Elmo Server',
    host: '100.89.16.27',
    user: 'root',
    owner: 'Elmo Herrera',
    projects: ['OnlyDrafting'],
  },
};

async function sshExec(serverKey, command, timeoutMs = 30000) {
  const server = SERVERS[serverKey];
  if (!server) throw new Error(`Unknown server: ${serverKey}. Known: ${Object.keys(SERVERS).join(', ')}`);

  // Sanitize command — block dangerous operations
  const BLOCKED = /rm\s+-rf\s+\/|mkfs|dd\s+if=|shutdown|reboot|halt|init\s+0/i;
  if (BLOCKED.test(command)) {
    throw new Error('Blocked: destructive command requires manual execution');
  }

  const sshCommand = `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 ${server.user}@${server.host} ${JSON.stringify(command)}`;

  try {
    const { stdout, stderr } = await execAsync(sshCommand, { timeout: timeoutMs });
    return { success: true, output: (stdout + '\n' + stderr).trim() };
  } catch (err) {
    return { success: false, error: err.message.substring(0, 500) };
  }
}

export async function getServerStatus(serverKey) {
  const server = SERVERS[serverKey];
  if (!server) return null;

  const checks = {};

  // Ping check
  try {
    const { stdout } = await execAsync(
      `ping -c 1 -W 3 ${server.host} 2>/dev/null | grep "time="`,
      { timeout: 5000 }
    );
    checks.reachable = !!stdout.trim();
    const timeMatch = stdout.match(/time=(\S+)/);
    checks.latency = timeMatch ? timeMatch[1] : 'unknown';
  } catch {
    checks.reachable = false;
  }

  if (!checks.reachable) {
    return { server: server.name, ...checks, status: 'offline' };
  }

  // System info via SSH
  const result = await sshExec(serverKey,
    'echo "UPTIME:$(uptime -p)"; echo "DISK:$(df -h / | tail -1 | awk \'{print $5}\')"; echo "MEM:$(free | awk \'/Mem/{printf \\"%.0f%%\\", $3/$2*100}\')"; echo "CONTAINERS:$(docker ps -q 2>/dev/null | wc -l)"',
    15000
  );

  if (result.success) {
    const lines = result.output.split('\n');
    for (const line of lines) {
      const [key, val] = line.split(':');
      if (key && val) checks[key.toLowerCase()] = val.trim();
    }
    checks.status = 'online';
  } else {
    checks.status = 'ssh_failed';
    checks.error = result.error;
  }

  return { server: server.name, owner: server.owner, host: server.host, ...checks };
}

export async function getAllServersStatus() {
  const results = {};
  for (const key of Object.keys(SERVERS)) {
    results[key] = await getServerStatus(key);
  }
  return results;
}

export async function runRemoteCommand(serverKey, command) {
  return sshExec(serverKey, command, 30000);
}

export async function deployToServer(serverKey, project) {
  const server = SERVERS[serverKey];
  if (!server) throw new Error(`Unknown server: ${serverKey}`);

  const result = await sshExec(serverKey,
    `cd /root/projects/${project} && git pull origin main 2>&1`,
    30000
  );
  return result;
}

export function formatAllServersStatus(statuses) {
  const lines = ['🌐 *Multi-Server Status*\n'];

  for (const [key, s] of Object.entries(statuses)) {
    const emoji = s.status === 'online' ? '🟢' : s.status === 'offline' ? '🔴' : '🟡';
    lines.push(`${emoji} *${s.server}* (${s.owner || key})`);
    lines.push(`  Host: ${s.host} | Status: ${s.status}`);

    if (s.status === 'online') {
      if (s.uptime) lines.push(`  Uptime: ${s.uptime}`);
      if (s.disk) lines.push(`  Disk: ${s.disk} | Memory: ${s.mem || '?'}`);
      if (s.containers) lines.push(`  Containers: ${s.containers}`);
      if (s.latency) lines.push(`  Latency: ${s.latency}`);
    } else if (s.error) {
      lines.push(`  Error: ${s.error.substring(0, 100)}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function getServerNames() {
  return Object.keys(SERVERS);
}
