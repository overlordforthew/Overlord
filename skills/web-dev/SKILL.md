# Skill: Web Development

## Scope
Full-stack web development for Gil's project fleet. Covers static sites, Node.js apps, Next.js, and WhatsApp bots — all containerized with Docker, routed via Traefik, deployed via Coolify or manual compose.

## Projects

| Project | Stack | Path | URL | Deploy |
|---------|-------|------|-----|--------|
| NamiBarden | Node 20 + Express + nginx (Alpine) | `/root/projects/NamiBarden/` | namibarden.com | `docker compose up -d --build` |
| BeastMode | Node 20 + Express (Alpine) | `/root/projects/BeastMode/` | beastmode.namibarden.com | Coolify auto-deploy |
| Lumina | Node 20 + Express + React/esbuild (Alpine) | `/root/projects/Lumina/` | lumina.namibarden.com | Coolify auto-deploy |
| MasterCommander | nginx + Node backend (Alpine) | `/root/projects/MasterCommander/` | mastercommander.namibarden.com | `docker cp` into container |
| OnlyHulls | Next.js 16 + TypeScript + Tailwind 4 | `/root/projects/OnlyHulls/` | onlyhulls.com | Coolify auto-deploy |
| Elmo | Pure static (nginx/Alpine) | `/root/projects/Elmo/` | onlydrafting.com | Coolify auto-deploy |
| SurfaBabe | Node 20 + Baileys + Claude CLI (Debian) | `/root/projects/SurfaBabe/` | surfababe.namibarden.com | GitHub webhook auto-deploy |
| ElSalvador | Python 3.12 + FastAPI | `/root/projects/ElSalvador/` | OFFLINE | Coolify (disabled) |

## Development Workflow

1. Edit code in `/root/projects/<name>/`
2. Test locally if applicable (for Node: `node server.js`, for Next.js: `npm run dev`)
3. `git add <specific files> && git commit -m "description" && git push`
4. Deploy per project method (see table above)
5. Verify with `curl -sI https://<domain>` and `docker logs <container> --tail 10`

**Git auth for push:** If `git push` fails with auth errors:
```bash
GH_TOKEN=$(grep '^GH_TOKEN=' /root/overlord/.env | cut -d'=' -f2-)
git remote set-url origin "https://bluemele:${GH_TOKEN}@github.com/bluemele/<repo>.git"
```

## Architecture Patterns

### Pattern 1: Static Site (Elmo)
Simplest pattern. No backend, no database. Just HTML/CSS/JS served by nginx.
- Base image: `alpine:3.23` with nginx from community repo
- nginx modules: `headers-more`, `brotli`
- 3-file nginx config: `nginx-main.conf` + `nginx.conf` + `security-headers.conf`
- Use for: landing pages, portfolios, simple marketing sites

### Pattern 2: Node + nginx Hybrid (NamiBarden)
Express API + nginx static file serving in one container.
- Base image: `node:20-alpine` with nginx installed via apk
- `entrypoint.sh` starts nginx in background, then `exec node server.js`
- nginx serves static files from `/usr/share/nginx/html`, proxies `/api/` to Express on `127.0.0.1:3100`
- Same 3-file nginx config as static pattern, plus brotli/headers-more
- Use for: content sites with an API layer (newsletters, contact forms, admin dashboards)

### Pattern 3: Express-Only (BeastMode, Lumina)
Express serves both API and static files. No nginx.
- Base image: `node:20-alpine`
- `express.static('public')` serves frontend
- SPA fallback: `app.get('*', (req, res) => res.sendFile('index.html'))`
- Lumina adds esbuild for React: `npx esbuild src/app.jsx --bundle --outfile=public/app.js --minify`
- Use for: SPAs with tight API coupling, PWAs

### Pattern 4: Next.js (OnlyHulls)
Full-stack TypeScript with App Router.
- 3-stage Dockerfile: deps → builder → runner
- `output: "standalone"` in next.config — copies `.next/standalone` to production image
- Non-root user (`nextjs`, uid 1001) in production
- Separate infra compose for PG+Meilisearch+Redis (not in app container)
- All lib modules use lazy init (`getStripe()`, `getMeili()`) to avoid build-time crashes
- Lockfile must be generated with npm 10 (node:20-alpine), NOT npm 11
- Use for: complex apps needing SSR, i18n, API routes, TypeScript

### Pattern 5: WhatsApp Bot (SurfaBabe)
Baileys + Claude CLI in a container.
- Base image: `node:20-bookworm-slim` (Debian, NOT Alpine — Claude CLI needs glibc)
- Claude CLI installed globally: `npm install -g @anthropic-ai/claude-code`
- Claude credentials bind-mounted from host (`/root/.claude/`)
- Git credentials bind-mounted at `/tmp/`, copied at startup
- Persistent volumes for auth, data, logs, media, knowledge
- Use for: AI-powered chat bots with WhatsApp integration

## Docker Patterns

### Base Image Selection
- **Alpine** (`node:20-alpine`, `alpine:3.23`): Default for everything. Smallest images.
- **Debian** (`node:20-bookworm-slim`): Only when native deps need glibc (Claude CLI, Puppeteer, sharp).

### Multi-Stage Builds (when you have build deps)
```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx esbuild src/app.jsx --bundle --outfile=public/app.js --minify

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/public ./public
COPY server.js .
EXPOSE 3000
CMD ["node", "server.js"]
```

### nginx Config Pattern (shared by NamiBarden + Elmo)
Three files, always:
- **`nginx-main.conf`** — Global: worker processes, brotli module loading, `more_clear_headers Server`
- **`nginx.conf`** — Server block: listen, root, locations, proxy_pass
- **`security-headers.conf`** — Included per-location: CSP, X-Frame-Options, HSTS, etc.

HTML: `no-cache, no-store, must-revalidate`. Static assets (css/js/img): 1-day cache.

### .dockerignore (always include)
```
node_modules
.git
.env
*.md
.claude
```

### Health Checks
```yaml
healthcheck:
  test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
  interval: 30s
  timeout: 5s
  retries: 3
```

## Database

All projects use **PostgreSQL**. Most on PG 17, MasterCommander on PG 16.

### Connection Pattern (Node.js)
```javascript
import pg from 'pg';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
```

### DB Container Pattern (standalone compose)
```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: myapp
      POSTGRES_USER: myapp
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U myapp"]
      interval: 10s
volumes:
  pgdata:
```

### OnlyHulls uses pgvector
```yaml
image: pgvector/pgvector:pg17  # instead of postgres:17-alpine
```

## Auth Patterns

### JWT + bcrypt (standard)
Used by BeastMode, Lumina, MasterCommander, NamiBarden admin.
```javascript
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

// Hash password
const hash = await bcrypt.hash(password, 10);

// Verify
const valid = await bcrypt.compare(password, hash);

// Sign token
const token = jwt.sign({ id: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
```

### Auth.js v5 (OnlyHulls)
Split config for edge compatibility:
- `auth.config.ts` — Edge-safe (no bcrypt, no pg). Used by middleware.
- `auth.ts` — Full server config with bcrypt + pg. Used by API routes.

## Traefik Routing

### Docker Labels (self-managed compose — NamiBarden)
```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.myapp.rule=Host(`myapp.namibarden.com`)"
  - "traefik.http.routers.myapp.entrypoints=websecure"
  - "traefik.http.routers.myapp.tls.certresolver=letsencrypt"
  - "traefik.http.services.myapp.loadbalancer.server.port=80"
  - "traefik.docker.network=coolify"
```
**Critical:** Always include `traefik.docker.network=coolify` if the container is on multiple networks. Without it, Traefik may route to the wrong IP and return 504s.

### File-Based Routes (custom domains not managed by Coolify)
Edit `/data/coolify/proxy/dynamic/namibarden.yaml`:
```yaml
http:
  routers:
    myapp:
      rule: "Host(`myapp.com`) || Host(`www.myapp.com`)"
      entryPoints: [websecure]
      service: myapp
      tls:
        certResolver: letsencrypt
  services:
    myapp:
      loadBalancer:
        servers:
          - url: "http://<container-ip>:<port>"
```

### Coolify-Managed (BeastMode, Lumina, Elmo, OnlyHulls)
Coolify handles Traefik config automatically. Custom labels can be added via Coolify API:
```bash
COOLIFY_TOKEN=$(grep '^COOLIFY_API_TOKEN=' /root/overlord/.env | cut -d'=' -f2-)
# Get current labels, modify, PATCH back (base64 encoded)
```

## Cloudflare DNS

All domains on Cloudflare. New subdomains for `*.namibarden.com` just need a Traefik route — the wildcard DNS already exists.

For new top-level domains (like onlyhulls.com, onlydrafting.com):
1. Add domain to Cloudflare
2. Set A record → server IP (proxied)
3. Add www CNAME → root domain (proxied)
4. Add file-based Traefik route in `namibarden.yaml`

API available via `CLOUDFLARE_API_TOKEN` in `/root/overlord/.env`.

## New Project Setup

```bash
# 1. Create project
mkdir -p /root/projects/<Name>
cd /root/projects/<Name>

# 2. Initialize
git init
# ... create Dockerfile, docker-compose.yml, package.json, etc.

# 3. Push to GitHub
GH_TOKEN=$(grep '^GH_TOKEN=' /root/overlord/.env | cut -d'=' -f2-)
git add -A && git commit -m "Initial commit"
gh repo create bluemele/<Name> --public --source=. --push
git remote set-url origin "https://bluemele:${GH_TOKEN}@github.com/bluemele/<Name>.git"

# 4. Set up Coolify (if auto-deploy desired)
# Create new resource in Coolify dashboard → connect GitHub repo → configure env vars

# 5. Or standalone compose (if manual deploy)
# Add Traefik labels to docker-compose.yml
# docker compose up -d --build
```

## Frontend Practices

### CSS
- No CSS frameworks on static/content sites (NamiBarden, Elmo) — hand-written CSS
- Tailwind 4 on Next.js (OnlyHulls) via `@tailwindcss/postcss`
- Use CSS custom properties for theming (dark mode, colors)

### Responsive
- Mobile-first approach
- Fluid typography with `clamp()`
- CSS Grid for layout, Flexbox for components

### Animations
- CSS transitions for hover/interactive states
- Intersection Observer for scroll reveal (NamiBarden pattern):
```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) entry.target.classList.add('revealed');
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
```

### Bilingual Sites (NamiBarden)
- `data-lang="ja"` / `data-lang="en"` attributes on elements
- Language toggle button switches `html[lang]` attribute
- CSS rules show/hide: `html[lang="en"] [data-lang="ja"] { display: none; }`
- LocalStorage persistence for language preference

### Performance
- Brotli compression (primary) + gzip fallback via nginx modules
- HTML: no-cache. Static assets: 1-day cache with fingerprinted filenames
- Lazy-load images below the fold
- Inline critical CSS for above-the-fold content
- `loading="lazy"` on images, `fetchpriority="high"` on hero images

## Security Checklist

- `.env` files: `chmod 600`, never committed to git
- CSP headers in `security-headers.conf` (restrict script-src, style-src)
- `more_clear_headers Server` in nginx (strips server identity)
- CORS: lock to specific origin, not `*`
- Rate limiting via Traefik (fail2ban jails active)
- Sanitize all user input (SQL: parameterized queries only, XSS: escape output)
- HTTPS enforced via Traefik (HTTP → HTTPS redirect)

## Compression Setup (nginx)

For any site using nginx, add brotli + headers-more modules:

**Dockerfile (Alpine):**
```dockerfile
RUN echo "https://dl-cdn.alpinelinux.org/alpine/v3.21/community" >> /etc/apk/repositories \
    && apk add --no-cache nginx nginx-mod-http-headers-more nginx-mod-http-brotli
```

**nginx-main.conf:**
```nginx
load_module modules/ngx_http_headers_more_filter_module.so;
load_module modules/ngx_http_brotli_filter_module.so;
load_module modules/ngx_http_brotli_static_module.so;

http {
    brotli on;
    brotli_types text/html text/css application/javascript application/json image/svg+xml;
    brotli_comp_level 6;
    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;
    more_clear_headers Server;
}
```

## Common Issues

### 504 Gateway Timeout
Container is on multiple Docker networks and Traefik picked the wrong one. Fix: add `traefik.docker.network=coolify` label.

### Build fails on npm ci
Lockfile was generated with wrong npm version. Regenerate with npm 10: `docker run --rm -v $PWD:/app -w /app node:20-alpine npm install`

### Container can't reach database
Both containers must be on the same Docker network. Coolify-managed apps use the `coolify` network. For standalone compose, add:
```yaml
networks:
  coolify:
    external: true
```

### Claude CLI fails in container
Needs Debian (bookworm-slim), not Alpine. Claude CLI has glibc dependencies. Also needs bind-mounted credentials from `/root/.claude/`.
