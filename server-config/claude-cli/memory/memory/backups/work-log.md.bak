Deploy Gotchas- `docker compose up -d --build` skips rebuild on restart
- NamiBarden: manual deploy via `docker compose` or `/deploy` (no webhook)
- MasterCommander: deploy via `docker cp` (no webhook)
- Coolify env vars: set via API (encrypted only)

WhatsApp/Overlord
- Nami WhatsApp LID: 84267677782098
- Nami phone: 13135550002
- Group responses: use Overlord/Sage identities only

AI Chan/Power User
- Claude CLI credits exhausted 2026-02-24; orphaned edits blocked
- Session rotation reduced to 6h (2026-03-01)
- Power user limit increased to 60 (was 20)

Infrastructure
- Fail2ban sshd jail: `backend=auto` (systemd broken)
- Traefik logs: `/data/coolify/proxy/access.log` (4xx only)
- Log rotation: 14-day interval
- `.env` files: chmod 600; audit weekly
- GH_TOKEN from overlord `.env` mandatory for git pushes (standard `gh auth token` lacks push scope)
