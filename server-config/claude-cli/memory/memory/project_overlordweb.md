---
name: OverlordWeb Terminal
description: Web-based terminal interface at overlord.namibarden.com — multi-pane tmux, Google OAuth, file upload
type: project
---

OverlordWeb is a browser-based root terminal at overlord.namibarden.com.

**Stack:** Node.js ESM, Express, xterm.js, node-pty, tmux, Passport Google OAuth 2.0
**Path:** /root/projects/OverlordWeb/
**GitHub:** bluemele/OverlordWeb (private)
**Deploy:** systemd service `overlord-web` on host (not Docker), port 3003

**Why:** Gives Gil full server access from any browser — same as SSH/Claude Code CLI.

**How to apply:**
- Deploy: `systemctl restart overlord-web`
- Auth: Google OAuth, only gilbarden@gmail.com
- OAuth creds: in /root/projects/OverlordWeb/.env (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
- Traefik route: in /data/coolify/proxy/dynamic/namibarden.yaml → host.docker.internal:3003
- UFW: ports 3003 allowed from 10.0.0.0/8 and 172.16.0.0/12 (Docker internal only)

**Features:**
- Multi-pane terminals with tab bar (max 8)
- tmux sessions per pane — persist across browser close/server restart
- CSS grid layouts: row, column, auto, split-h/v, 2x2 grid
- File upload via drag-drop and Ctrl+V clipboard paste (navigator.clipboard API)
- Keyboard shortcuts: Ctrl+Shift+N/W/[/]/L/1-8
