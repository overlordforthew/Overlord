#!/usr/bin/env node
/**
 * seed-semantic.mjs — Migrate knowledge from .md files into semantic_memories table.
 * Run once after schema creation, then again whenever .md files are updated.
 *
 * Idempotent: uses saveSemantic() which upserts on category+topic.
 */

import pg from 'pg';
import { readFileSync, existsSync } from 'fs';

// ── DB CONNECTION ─────────────────────────────────────────────────────────────

let _dbPass = process.env.CONV_DB_PASS || process.env.MEMORY_DB_PASS;
if (!_dbPass) {
  for (const p of ['/app/data/.overlord-db-pass', '/root/overlord/data/.overlord-db-pass']) {
    try { _dbPass = readFileSync(p, 'utf-8').trim(); break; } catch { /* next */ }
  }
}
if (!_dbPass) {
  for (const envPath of ['/root/overlord/.env', '/app/.env']) {
    try {
      const env = readFileSync(envPath, 'utf-8');
      const match = env.match(/CONV_DB_PASS=(.+)/);
      if (match) { _dbPass = match[1].trim(); break; }
    } catch { /* next */ }
  }
}

const pool = new pg.Pool({
  host: process.env.MEMORY_DB_HOST || (existsSync('/app') ? 'overlord-db' : '127.0.0.1'),
  port: parseInt(process.env.MEMORY_DB_PORT || '5432'),
  database: process.env.MEMORY_DB_NAME || 'overlord',
  user: process.env.MEMORY_DB_USER || 'overlord',
  password: _dbPass,
  max: 3,
  connectionTimeoutMillis: 5000,
});

async function save({ category, topic, content, importance = 0.5, tags = [], project = null, source = 'migrated' }) {
  const summary = content.split('\n')[0].slice(0, 60);
  const { rows: existing } = await pool.query(
    `SELECT id FROM semantic_memories WHERE category = $1 AND topic = $2 AND is_active = TRUE`,
    [category, topic]
  );

  if (existing.length) {
    await pool.query(
      `UPDATE semantic_memories SET content = $1, summary = $2, importance = GREATEST(importance, $3),
       tags = $4, project = $5, source = $6, updated_at = NOW() WHERE id = $7`,
      [content.trim(), summary, importance, tags, project, source, existing[0].id]
    );
    return { id: existing[0].id, action: 'updated' };
  }

  const { rows } = await pool.query(
    `INSERT INTO semantic_memories (category, topic, content, summary, importance, source, tags, project)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [category, topic, content.trim(), summary, importance, source, tags, project]
  );
  return { id: rows[0].id, action: 'created' };
}

async function saveProcedure({ trigger, procedure, category = 'ops', project = null }) {
  const { rows: existing } = await pool.query(
    `SELECT id FROM procedural_memories WHERE trigger_pattern = $1 AND is_active = TRUE`,
    [trigger]
  );

  if (existing.length) {
    await pool.query(
      `UPDATE procedural_memories SET procedure = $1, category = $2, project = $3, updated_at = NOW() WHERE id = $4`,
      [procedure, category, project, existing[0].id]
    );
    return { id: existing[0].id, action: 'updated' };
  }

  const { rows } = await pool.query(
    `INSERT INTO procedural_memories (trigger_pattern, procedure, category, project)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [trigger, procedure, category, project]
  );
  return { id: rows[0].id, action: 'created' };
}

// ── SEED DATA ─────────────────────────────────────────────────────────────────

async function seed() {
  let created = 0, updated = 0;

  function log(r, label) {
    if (r.action === 'created') created++;
    else updated++;
    console.log(`  ${r.action}: ${label} (id:${r.id})`);
  }

  console.log('=== Seeding Tools ===');

  log(await save({
    category: 'tool', topic: 'gws',
    content: 'Google Workspace CLI (gws v0.8.0) — fully authenticated as overlord.gil.ai@gmail.com. Scopes: Gmail, Calendar, Drive, Sheets, Docs, Tasks. Credentials at ~/.config/gws/credentials.json. Usage: gws gmail users messages list --params \'{"userId":"me","maxResults":10,"q":"in:inbox is:unread"}\'. Refresh token may expire ~7 days — re-auth with gws auth login. Gil has authorized autonomous use of Gmail, Calendar, Drive, Sheets, Docs.',
    importance: 0.9, tags: ['gmail', 'calendar', 'drive', 'google', 'email'], source: 'migrated'
  }), 'tool/gws');

  log(await save({
    category: 'tool', topic: 'codex-cli',
    content: 'Codex CLI (codex review --commit HEAD) — free code review via ChatGPT auth (NOT API). Auth stored at /root/.codex/auth.json, mounted into container. Model: gpt-5.2-codex in ~/.codex/config.toml. Auto-review script: scripts/codex-review.sh. MANDATORY for all significant code changes.',
    importance: 0.8, tags: ['code-review', 'openai'], source: 'migrated'
  }), 'tool/codex-cli');

  log(await save({
    category: 'tool', topic: 'llm-cli',
    content: 'llm CLI (v0.28) — universal LLM interface via OpenRouter plugin. 26+ free models: DeepSeek R1, Llama 3.3 70B, Gemma 3, Qwen3, etc. Best default: llm -m openrouter/openrouter/free "prompt" (auto-picks best available). OpenRouter key auto-configured on container start from OPENROUTER_KEY env var.',
    importance: 0.7, tags: ['llm', 'openrouter', 'free'], source: 'migrated'
  }), 'tool/llm-cli');

  log(await save({
    category: 'tool', topic: 'chrome-gui',
    content: 'Headful Chrome browser — systemd service chrome-gui. Access: http://100.83.80.116:6080/vnc.html (Tailscale-only, no password). CDP port 9223 for programmatic control via chrome-cdp MCP. Profile: /root/.chrome-gui-profile/ (persistent cookies/sessions). Logged into: Gmail (overlord.gil.ai@gmail.com), X/Twitter (@OverlordForTheW). human.mjs skill for realistic interaction.',
    importance: 0.7, tags: ['browser', 'chrome', 'cdp', 'automation'], source: 'migrated'
  }), 'tool/chrome-gui');

  log(await save({
    category: 'tool', topic: 'claude-cli',
    content: 'Claude CLI — Anthropic Claude Code CLI. Uses OAuth (no API key needed). Auth refresh cron every 6h. Installed globally in container via npm install -g @anthropic-ai/claude-code. Model locked to claude-opus-4-6.',
    importance: 0.8, tags: ['claude', 'anthropic', 'ai'], source: 'migrated'
  }), 'tool/claude-cli');

  log(await save({
    category: 'tool', topic: 'docker',
    content: 'Docker CLI available in Overlord container via mounted /var/run/docker.sock. Can manage all containers on the host. Use docker ps, docker logs, docker exec, docker cp, docker compose.',
    importance: 0.7, tags: ['docker', 'container'], source: 'migrated'
  }), 'tool/docker');

  log(await save({
    category: 'tool', topic: 'gh-cli',
    content: 'GitHub CLI (gh) — available in container. GH_TOKEN in /root/overlord/.env for push access. For git push: git remote set-url origin "https://bluemele:${GH_TOKEN}@github.com/bluemele/REPO.git". gh auth token lacks push scope.',
    importance: 0.7, tags: ['github', 'git'], source: 'migrated'
  }), 'tool/gh-cli');

  log(await save({
    category: 'tool', topic: 'discord-mcp',
    content: 'Discord MCP — bot app ID 1479963348228636894. Token in /root/.claude.json mcpServers.discord.env. Tools: list servers, read/send/delete messages, search, manage channels, forums, webhooks, reactions.',
    importance: 0.5, tags: ['discord', 'mcp', 'bot'], source: 'migrated'
  }), 'tool/discord-mcp');

  log(await save({
    category: 'tool', topic: 'yt-dlp',
    content: 'yt-dlp installed at /usr/local/bin/yt-dlp for downloading videos/audio from YouTube and other platforms.',
    importance: 0.4, tags: ['youtube', 'video', 'download'], source: 'migrated'
  }), 'tool/yt-dlp');

  log(await save({
    category: 'tool', topic: 'veo',
    content: 'Google Veo video generation (/veo skill). API key: GOOGLE_API_KEY in /root/.env, free tier with daily limits.',
    importance: 0.4, tags: ['video', 'ai', 'google'], source: 'migrated'
  }), 'tool/veo');

  log(await save({
    category: 'tool', topic: 'shannon',
    content: 'Shannon AI Pentest Framework at /root/projects/shannon/. Run: ./shannon start URL=<url> REPO=<name>. Resume: ./shannon start URL=<original-url> REPO=<name> WORKSPACE=<workspace-name>. All projects audited — Shannon shut down (restart when needed).',
    importance: 0.4, tags: ['security', 'pentest'], source: 'migrated'
  }), 'tool/shannon');

  console.log('\n=== Seeding Projects ===');

  log(await save({
    category: 'project', topic: 'overlord',
    content: 'WhatsApp AI Bot + Workspace at /root/overlord/. Stack: Node.js, Baileys (WhatsApp Web), Claude CLI. Runs in Docker on coolify network. Admin: Gil (full shell+Docker+Git from WhatsApp). Per-chat memory: /root/overlord/data/<chat_id>/memory.md. Deploy: docker compose up -d --build.',
    importance: 0.9, tags: ['whatsapp', 'bot', 'node'], project: 'overlord', source: 'migrated'
  }), 'project/overlord');

  log(await save({
    category: 'project', topic: 'namibarden',
    content: 'Main site + Newsletter + Course Platform at /root/projects/NamiBarden/. URL: namibarden.com. Stack: Node.js 20 + Express + nginx, PG 17 (namibarden-db). Deploy: docker compose up -d --build (NO auto-deploy webhook). Courses: HLS video via R2. Stripe integration.',
    importance: 0.8, tags: ['website', 'courses', 'stripe'], project: 'namibarden', source: 'migrated'
  }), 'project/namibarden');

  log(await save({
    category: 'project', topic: 'mastercommander',
    content: 'AI Boat Monitor Landing Page at /root/projects/MasterCommander/. URL: mastercommander.namibarden.com. Stack: Static HTML/CSS/JS, nginx:alpine. Auth backend: Overlord server.js. Deploy: docker cp (no webhook). DB: mastercommander-db with users, boats, boat_logs, gate_users, gate_nda tables.',
    importance: 0.7, tags: ['boat', 'iot', 'landing'], project: 'mastercommander', source: 'migrated'
  }), 'project/mastercommander');

  log(await save({
    category: 'project', topic: 'beastmode',
    content: 'Web App + API at /root/projects/BeastMode/. URL: beastmode.namibarden.com. Coolify app UUID ug80oocw84scswk084kcw0ok. Deploy: Coolify auto-deploy on git push.',
    importance: 0.6, tags: ['webapp'], project: 'beastmode', source: 'migrated'
  }), 'project/beastmode');

  log(await save({
    category: 'project', topic: 'lumina',
    content: 'Auth/Account System. URL: lumina.namibarden.com. Stack: Node.js + Express + React (esbuild), PG 17, JWT. Deploy: Coolify auto-deploy on git push.',
    importance: 0.6, tags: ['auth', 'react'], project: 'lumina', source: 'migrated'
  }), 'project/lumina');

  log(await save({
    category: 'project', topic: 'surfababe',
    content: 'SurfaBabe Wellness WhatsApp AI at /root/projects/SurfaBabe/. URL: surfababe.namibarden.com. Stack: Node.js/Baileys/Claude CLI (Overlord fork). Admin: Ailie (+81 70-8418-9804). Models: Opus 4.6 (Ailie), Sonnet 4.6 (customers). Deploy: GitHub webhook auto-deploy.',
    importance: 0.7, tags: ['whatsapp', 'wellness'], project: 'surfababe', source: 'migrated'
  }), 'project/surfababe');

  log(await save({
    category: 'project', topic: 'elmo',
    content: 'OnlyDrafting at /root/projects/Elmo/. Domain: onlydrafting.com. Coolify token zkk0k8gcgcss4osggs4k0kw4. Deploy: Coolify auto-deploy on git push.',
    importance: 0.5, tags: ['drafting'], project: 'elmo', source: 'migrated'
  }), 'project/elmo');

  log(await save({
    category: 'project', topic: 'onlyhulls',
    content: 'AI Boat Matchmaking at /root/projects/OnlyHulls/. Domain: onlyhulls.com. Stack: Next.js 16, PG 17. Coolify token qkggs84cs88o0gww4wc80gwo. Deploy: Coolify auto-deploy.',
    importance: 0.5, tags: ['boat', 'nextjs'], project: 'onlyhulls', source: 'migrated'
  }), 'project/onlyhulls');

  log(await save({
    category: 'project', topic: 'elsalvador',
    content: 'ElSalvador Land Scout — OFFLINE. Stack: Python 3.12, FastAPI, Playwright. Coolify app ID q0wcsgo0wccsgkows08gocks. Auto-deploy disabled.',
    importance: 0.3, tags: ['python', 'scraper', 'offline'], project: 'elsalvador', source: 'migrated'
  }), 'project/elsalvador');

  console.log('\n=== Seeding Infrastructure ===');

  log(await save({
    category: 'infrastructure', topic: 'server',
    content: 'Hetzner CX33 — Ubuntu 24.04, 4-core AMD EPYC, 8GB RAM, 80GB SSD. IP: 89.167.12.82. Tailscale: 100.83.80.116. Coolify (coolify.namibarden.com). Traefik v3.6 (HTTPS/LE). PostgreSQL 17 (multiple instances). Redis 7.',
    importance: 0.9, tags: ['hetzner', 'ubuntu', 'coolify'], source: 'migrated'
  }), 'infrastructure/server');

  log(await save({
    category: 'infrastructure', topic: 'tailscale',
    content: 'Tailscale network (gilbarden@): Overlord 100.83.80.116, Elmoserver 100.89.16.27 (shared from elmoherrera2014@), Laptop 100.127.240.116, Galaxy A55 100.85.118.93.',
    importance: 0.6, tags: ['vpn', 'network'], source: 'migrated'
  }), 'infrastructure/tailscale');

  log(await save({
    category: 'infrastructure', topic: 'traefik',
    content: 'Traefik v3.6 reverse proxy. Config source of truth: /data/coolify/proxy/dynamic/namibarden.yaml. Access log: /data/coolify/proxy/access.log (4xx only, logrotated 14d). Cloudflare wildcard *.namibarden.com — new subdomains just need Traefik routes, no DNS changes.',
    importance: 0.8, tags: ['proxy', 'ssl', 'routing'], source: 'migrated'
  }), 'infrastructure/traefik');

  log(await save({
    category: 'infrastructure', topic: 'coolify',
    content: 'Coolify deployment platform at coolify.namibarden.com (Tailscale-restricted). API: curl -H "Authorization: Bearer $COOLIFY_API_TOKEN" http://localhost:8000/api/v1/... Use localhost:8000, NOT coolify.namibarden.com (Tailscale-restricted).',
    importance: 0.7, tags: ['deploy', 'paas'], source: 'migrated'
  }), 'infrastructure/coolify');

  log(await save({
    category: 'infrastructure', topic: 'cloudflare',
    content: 'Cloudflare full API access. Zones: namibarden.com (51ea8958dc949e1793c0d31435cfa699), onlydrafting.com (5a4473673d3df140fa184e36f8567031), onlyhulls.com (3d950be33832c344c40e7bd75a5c7ac2). R2 bucket: namibarden-courses. Domains: namibarden (2029), onlyhulls (2029), onlydrafting (2027).',
    importance: 0.7, tags: ['dns', 'cdn', 'r2'], source: 'migrated'
  }), 'infrastructure/cloudflare');

  log(await save({
    category: 'infrastructure', topic: 'cron-jobs',
    content: 'Root crontab: health-check (6h), backup (midnight), morning-brief (6am), Claude auth refresh (6h), auto-journal (11:55pm), memory-cleanup (3:30am), token-aggregate (2:55am), CF token rotate (quarterly), email check (11am).',
    importance: 0.5, tags: ['cron', 'automation'], source: 'migrated'
  }), 'infrastructure/cron-jobs');

  console.log('\n=== Seeding Security ===');

  log(await save({
    category: 'security', topic: 'fail2ban',
    content: 'Fail2ban 4 active jails: sshd (3 retries/10min → 3h ban), traefik-auth (5/5min → 6h), traefik-botsearch (3/1min → 24h, wp-admin/.env/.git scanners), traefik-ratelimit (20/1min → 1h). Safe IPs: localhost, Docker internal, Tailscale 100.64.0.0/10. Config: /etc/fail2ban/jail.local.',
    importance: 0.8, tags: ['firewall', 'banning'], source: 'migrated'
  }), 'security/fail2ban');

  log(await save({
    category: 'security', topic: 'ssh',
    content: 'SSH key-only auth. Restricted to private ranges (10.0.0.0/8, 172.16.0.0/12) + Tailscale. Users: root (primary), gil (UID 1000, passwordless sudo, Docker group).',
    importance: 0.7, tags: ['access', 'auth'], source: 'migrated'
  }), 'security/ssh');

  log(await save({
    category: 'security', topic: 'mc-auth',
    content: 'MasterCommander auth: MC_JWT_SECRET rotated. Rate limiters use req.ip. requireMcAuth rejects gate tokens. Gate OTP uses crypto.randomInt() with lockout. HTML injection: escapeHtml() on email fields. Token versioning: token_version in users table, checked on auth.',
    importance: 0.6, tags: ['jwt', 'auth', 'mastercommander'], source: 'migrated'
  }), 'security/mc-auth');

  console.log('\n=== Seeding Integrations ===');

  log(await save({
    category: 'integration', topic: 'stripe',
    content: 'Stripe (NamiBarden): account gilbarden@gmail.com, US. CLI: stripe-nb. Keys in /root/projects/NamiBarden/.env. Webhook: https://namibarden.com/api/stripe/webhook.',
    importance: 0.6, tags: ['payments', 'namibarden'], project: 'namibarden', source: 'migrated'
  }), 'integration/stripe');

  log(await save({
    category: 'integration', topic: 'coolify-api',
    content: 'Coolify API token "15|overlord-41ed95a28669181758a73dd1901ef812" in /root/overlord/.env (COOLIFY_API_TOKEN). Use http://localhost:8000/api/v1/... (NOT coolify.namibarden.com). Tokens in personal_access_tokens table are SHA-256 hashed.',
    importance: 0.6, tags: ['api', 'deploy'], source: 'migrated'
  }), 'integration/coolify-api');

  log(await save({
    category: 'integration', topic: 'cloudflare-api',
    content: 'Cloudflare full access: Global API Key + email auth (X-Auth-Key/X-Auth-Email) in /root/overlord/.env. Account ID: 099cbdaaadc71eef10329f795a4e564f. rclone configured at /root/.config/rclone/rclone.conf. R2 upload: /root/scripts/r2-upload.sh.',
    importance: 0.6, tags: ['api', 'dns', 'r2'], source: 'migrated'
  }), 'integration/cloudflare-api');

  console.log('\n=== Seeding People ===');

  log(await save({
    category: 'person', topic: 'gil',
    content: 'Gil — Owner/Admin. Phone: 13055601031. GitHub: bluemele. Email: overlord.gil.ai@gmail.com. X: @overlordforthew. Waking hours: ~5:30am-9:00pm. JID: 18587794588@s.whatsapp.net (LID: 109457291874478@lid). Wants action not advice.',
    importance: 1.0, tags: ['admin', 'owner'], source: 'migrated'
  }), 'person/gil');

  log(await save({
    category: 'person', topic: 'aichan',
    content: 'Ai Chan (Nami) — Power user. JID: 84393251371@s.whatsapp.net. Projects: NamiBarden, Lumina. Can use docker ps/exec for her projects only. Prompt-based restrictions.',
    importance: 0.6, tags: ['power-user'], source: 'migrated'
  }), 'person/aichan');

  log(await save({
    category: 'person', topic: 'dex',
    content: 'Dex (Seneca) — Power user, age 15. Can request projects via /newproject. Locked to his projects, no server access.',
    importance: 0.5, tags: ['power-user'], source: 'migrated'
  }), 'person/dex');

  log(await save({
    category: 'person', topic: 'ailie',
    content: 'Ailie — SurfaBabe admin, Gil\'s daughter. Phone: +81 70-8418-9804. SurfaBabe Wellness owner. Email: uptoyou.wellness@gmail.com. Website: surfababe.com.',
    importance: 0.6, tags: ['surfababe', 'family'], source: 'migrated'
  }), 'person/ailie');

  log(await save({
    category: 'person', topic: 'elmo',
    content: 'Elmo Herrera — OnlyDrafting owner. Tailscale account: elmoherrera2014@gmail.com. Server: elmoserver (100.89.16.27).',
    importance: 0.5, tags: ['client'], source: 'migrated'
  }), 'person/elmo');

  console.log('\n=== Seeding Preferences ===');

  log(await save({
    category: 'preference', topic: 'action-first',
    content: 'Gil wants action, not advice. Execute first, explain after. Gil is a developer.',
    importance: 0.9, tags: ['workflow'], source: 'migrated'
  }), 'preference/action-first');

  log(await save({
    category: 'preference', topic: 'codex-mandatory',
    content: 'Codex review is MANDATORY for all significant code changes — always run codex review --commit HEAD before final push.',
    importance: 0.8, tags: ['code-review', 'rule'], source: 'migrated'
  }), 'preference/codex-mandatory');

  log(await save({
    category: 'preference', topic: 'new-projects',
    content: 'New projects: Always init git, create GitHub repo under bluemele/, push, and set up Coolify webhook.',
    importance: 0.7, tags: ['workflow', 'git'], source: 'migrated'
  }), 'preference/new-projects');

  log(await save({
    category: 'preference', topic: 'gmail-cleanup',
    content: 'Always unsubscribe from marketing/promo emails during inbox cleanup. Archive informational noise (security alerts already reviewed, test emails, bounce-backs).',
    importance: 0.6, tags: ['email'], source: 'migrated'
  }), 'preference/gmail-cleanup');

  log(await save({
    category: 'preference', topic: 'error-autofix',
    content: 'Error auto-fix protocol: When error detected, research and understand it, attempt autonomous fix, run codex review, notify Gil with outcome (never raw errors). Gil only sees the outcome report.',
    importance: 0.8, tags: ['error-handling', 'rule'], source: 'migrated'
  }), 'preference/error-autofix');

  console.log('\n=== Seeding Patterns ===');

  log(await save({
    category: 'pattern', topic: 'whatsapp-jids',
    content: 'Key WhatsApp JIDs: Gil: 18587794588@s.whatsapp.net (LID: 109457291874478@lid), Nami: 84393251371@s.whatsapp.net, Emiel: 19195008873@s.whatsapp.net, Bot (Sage): 13055601031@s.whatsapp.net, SurfaBabe bot: 84392648332@s.whatsapp.net.',
    importance: 0.7, tags: ['whatsapp', 'contacts'], source: 'migrated'
  }), 'pattern/whatsapp-jids');

  log(await save({
    category: 'pattern', topic: 'api-keys',
    content: 'API keys in /root/overlord/.env: OPENROUTER_KEY (active), GOOGLE_API_KEY (active), GH_TOKEN (active), GROQ_API_KEY (active), WEBHOOK_TOKEN (active), COOLIFY_API_TOKEN (active), CLOUDFLARE_GLOBAL_API_KEY (active). OPENAI_API_KEY: commented out. ANTHROPIC_API_KEY: deleted.',
    importance: 0.8, tags: ['credentials', 'env'], source: 'migrated'
  }), 'pattern/api-keys');

  console.log('\n=== Seeding Procedures ===');

  log(await saveProcedure({
    trigger: 'deploying overlord',
    procedure: '1. cd /root/overlord\n2. git add <files> && git commit -m "message" && git push\n3. docker compose up -d --build\n4. docker logs overlord --tail 20 (verify)\n5. Run codex-review.sh if code changed',
    category: 'deploy', project: 'overlord'
  }), 'deploy/overlord');

  log(await saveProcedure({
    trigger: 'deploying namibarden',
    procedure: '1. cd /root/projects/NamiBarden\n2. Edit files, git add, commit, push\n3. docker compose up -d --build\n4. Verify with docker logs',
    category: 'deploy', project: 'namibarden'
  }), 'deploy/namibarden');

  log(await saveProcedure({
    trigger: 'deploying mastercommander',
    procedure: '1. cd /root/projects/MasterCommander\n2. Edit files, git add, commit, push\n3. docker cp into mastercommander container\n4. Verify site loads',
    category: 'deploy', project: 'mastercommander'
  }), 'deploy/mastercommander');

  log(await saveProcedure({
    trigger: 'adding new subdomain',
    procedure: '1. Cloudflare wildcard handles DNS (no changes needed)\n2. Add Traefik route to /data/coolify/proxy/dynamic/namibarden.yaml\n3. Restart Traefik: docker restart coolify-proxy\n4. Verify: curl -sI https://newsubdomain.namibarden.com',
    category: 'ops'
  }), 'ops/new-subdomain');

  log(await saveProcedure({
    trigger: 'checking email',
    procedure: '1. gws gmail users messages list --params \'{"userId":"me","maxResults":10,"q":"in:inbox is:unread"}\'\n2. For each message: gws gmail users messages get --params \'{"userId":"me","id":"MSG_ID","format":"full"}\'\n3. Summarize to Gil\n4. Unsubscribe from marketing, archive noise',
    category: 'ops'
  }), 'ops/check-email');

  log(await saveProcedure({
    trigger: 'debugging container crash',
    procedure: '1. docker ps -a (check status/exit code)\n2. docker logs <container> --tail 50\n3. docker inspect <container> | jq ".[0].State"\n4. If OOM: check mem_limit in docker-compose.yml\n5. If code error: read logs, trace to file, fix\n6. docker compose up -d --build to rebuild',
    category: 'debug'
  }), 'debug/container-crash');

  log(await saveProcedure({
    trigger: 'fail2ban check',
    procedure: '1. fail2ban-client status (list jails)\n2. fail2ban-client status <jail> (banned IPs)\n3. fail2ban-client set <jail> unbanip <IP> (unban)\n4. Config: /etc/fail2ban/jail.local\n5. Filters: /etc/fail2ban/filter.d/traefik-*.conf',
    category: 'security'
  }), 'security/fail2ban');

  log(await saveProcedure({
    trigger: 'git push from container',
    procedure: '1. Source GH_TOKEN from /root/overlord/.env\n2. git remote set-url origin "https://bluemele:${GH_TOKEN}@github.com/bluemele/REPO.git"\n3. git push\n4. Reset URL after if needed for security',
    category: 'develop'
  }), 'develop/git-push');

  console.log(`\n=== Seed Complete: ${created} created, ${updated} updated ===`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

try {
  // Verify tables exist
  await pool.query('SELECT 1 FROM semantic_memories LIMIT 0');
  await pool.query('SELECT 1 FROM procedural_memories LIMIT 0');
} catch (err) {
  console.error('Tables not found. Please create schema first (run the app or ensureSemanticSchema).');
  console.error(err.message);
  process.exit(1);
}

await seed();
await pool.end();
