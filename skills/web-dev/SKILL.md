# Skill: Web Development

## Scope
Full-stack web development, deployment via Coolify, and mobile wrapping with Capacitor.

## Development Workflow
1. Code in /root/projects/<name>/
2. Test locally if applicable
3. `git add -A && git commit -m "description" && git push`
4. Coolify auto-deploys via GitHub webhook
5. Verify at https://<app>.namibarden.com

## Active Projects
- **BeastMode** (Node.js): /root/projects/BeastMode → beastmode.namibarden.com
- **Lumina** (Node.js + React): /root/projects/Lumina → lumina.namibarden.com
- **NamiBarden** (static/content): /root/projects/NamiBarden → namibarden.com
- **ElSalvador** (Python FastAPI): /root/projects/ElSalvador → elsalvador.namibarden.com

## Tech Stack Preferences
- Backend: Node.js (Express) or Python (FastAPI)
- Frontend: React (with esbuild or Vite)
- Database: PostgreSQL 17
- Auth: JWT + bcrypt
- Deployment: Docker + Coolify
- Domain: *.namibarden.com via Cloudflare

## Coolify Deployment Setup
1. Create new resource in Coolify dashboard
2. Connect GitHub repo (bluemele/<name>)
3. Set build pack (Dockerfile or Nixpacks)
4. Configure environment variables
5. Set domain and SSL (auto via Traefik)
6. Webhook auto-triggers on push to main

## Docker Best Practices
- Use slim base images (node:20-slim, python:3.12-slim)
- Multi-stage builds when possible
- .dockerignore for node_modules, .git, etc.
- Health checks in Dockerfile or compose

## New Project Template
```bash
mkdir -p /root/projects/<name>
cd /root/projects/<name>
git init
# ... create files ...
git add -A && git commit -m "Initial commit"
gh repo create bluemele/<name> --public --source=. --push
```
Then set up in Coolify.

## Mobile Wrapping (Capacitor)
See skills/mobile-dev/SKILL.md for Capacitor-specific workflow.
