Deploy Gotchas  
- `docker restart` skips rebuild; use `docker compose up -d --build`  
- NamiBarden requires manual deploy (`docker compose` or `/deploy`) due to no Coolify webhook  
- MasterCommander needs `docker cp` deployment (no webhook)  
- Coolify env vars must go through API (encrypted values)  

WhatsApp/Overlord  
- Nami's WhatsApp LID `84267677782098` and phone `13135550002` required  
- Group chats: respond as Overlord/Sage, not personal agents  
- OpenRouter/auto models cause token burn; use `gpt-4.1-nano` for chat widget  
- Session rotation set to 6h (2026-03-01) to prevent bloat  
- Power user turn limit raised to 60 (was 20)  

AI Chan/Power User  
- 2026-02-24: Claude CLI credits exhausted mid-session; orphaned edits fixed by enforcing tool restrictions at code level  

Infrastructure  
- Fail2ban sshd jail requires `backend=auto` (systemd backend broken)  
- Traefik logs 4xx only (`/data/coolify/proxy/access.log`), logrotate 14d  
- `.env` files chmod 600; audit regularly  
- GH_TOKEN from overlord `.env` needed for git pushes (gh auth token lacks push scope)
