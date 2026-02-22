# OVERLORD — Long-Term Memory

## System Initialized
- **Date:** 2026-02-22
- **Event:** OVERLORD workspace bootstrapped with full directory structure
- **Migration:** Moved from /root/overlord/ to /root/overlord/ (new `gil` user)

## Server Facts
- **Hostname:** Overlord
- **Provider:** Hetzner CX33 (4 vCPU AMD EPYC, 8GB RAM, 80GB SSD)
- **OS:** Ubuntu 24.04.4 LTS (Noble Numbat)
- **Swap:** 8 GB configured
- **Orchestration:** Coolify (coolify.namibarden.com, Tailscale-only)
- **Proxy:** Traefik v3.6 (HTTPS/Let's Encrypt)
- **Databases:** PostgreSQL 17 (multiple instances), Redis 7

## Network & Security
- **Firewall:** UFW active (80/443 public, SSH private ranges only)
- **Tailscale IP:** 100.83.80.116
- **SSH:** restricted to 10.0.0.0/8, 172.16.0.0/12
- **Traefik config:** /data/coolify/proxy/dynamic/namibarden.yaml (source of truth)
- **Tailscale-restricted:** coolify.namibarden.com, openclaw.namibarden.com
- **Public:** namibarden.com, beastmode.namibarden.com, lumina.namibarden.com, elsalvador.namibarden.com

## WhatsApp Bot
- **Admin LID:** 109457291874478 (WhatsApp LID doesn't match phone number)
- **Admin phone:** 13055601031
- **Session:** Baileys auth stored in auth/ directory (critical — don't delete)
- **Per-chat memory:** data/<chat_id>/memory.md
- **Per-chat context:** data/<chat_id>/context.json (rolling 50-message buffer)

## Key Decisions
- OpenClaw stopped (2026-02-21) to save RAM — Overlord replaces it
- Docker prune + journald cleanup freed ~6GB (2026-02-21)
- ElSalvador upgraded from httpx to Playwright for Cloudflare bypass
- Conversation context made persistent (context.json per chat)

## Preferences
- Gil wants action, not advice — execute first, explain after
- New projects: always init git, create GitHub repo under bluemele/, set up Coolify webhook
- All apps containerized, deployed from GitHub via Coolify
- GitHub webhooks auto-deploy on push: BeastMode, Lumina, NamiBarden, ElSalvador
