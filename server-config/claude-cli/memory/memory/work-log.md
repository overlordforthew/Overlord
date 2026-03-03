Deploy Gotchas  
- Use `docker compose up -d --build` (restarts skip rebuild)  
- NamiBarden requires manual deployment via `docker compose` or `/deploy` (no Coolify webhook)  
- MasterCommander deploys with `docker cp` (no webhook support)  
- Coolify environment variables must be set via API (encrypted values only)  

WhatsApp/Overlord  
- Nami's WhatsApp LID: 84267677782098  
- Nami's phone number: 13135550002  
- Group responses must use Overlord/Sage identities only  

AI Chan/Power User  
- Claude CLI credits exhausted mid-session on 2026-02-24; orphaned edits prevented by code-level tool restriction enforcement  
- Session rotation reduced to 6h (2026-03-01)  
- Power user turn limit increased to 60 (was 20)  

Infrastructure  
- Use `backend=auto` in Fail2ban sshd jail (systemd backend broken)  
- Traefik logs: `/data/coolify/proxy/access.log` (4xx only)  
- Log rotation: 14-day interval  
- `.env` files require chmod 600; audit weekly  
- GH_TOKEN from overlord `.env` mandatory for git pushes (standard `gh auth token` lacks push scope)
